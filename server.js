const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

app.use(bodyParser.json());

// 自定义路由（放在 static 之前）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

app.get('/large-screen.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Old route removed. New route defined below as ADMIN_ROUTE.

app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// Admin panel route - CHANGE THIS FOR PRODUCTION SECURITY
const ADMIN_ROUTE = '/admin';

app.get(ADMIN_ROUTE, (req, res) => {
    res.sendFile(path.join(__dirname, 'secure_admin', 'admin.html'));
});

const CONFIG = {
    totalEnergy: 10000,
    drainRate: 150,
    drainInterval: 100,
};

let db = { users: [], prizes: [], settings: { randomAvatars: false } };

if (fs.existsSync(DB_FILE)) {
    try { 
        const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
        db = { ...db, ...loaded };
        // Ensure settings exist
        if (!db.settings) db.settings = { randomAvatars: false };
    } catch (e) {}
}

// 优化：异步批量数据库写入，避免同步I/O阻塞
let saveTimeout = null;
let isDirty = false;
let isWriting = false;

function scheduleSave() {
    if (saveTimeout) return;
    // 延迟100ms后统一写入，这样可以把多个操作合并为一次写入
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        flushDbAsync();
    }, 100);
}

function flushDbAsync() {
    if (isWriting) {
        scheduleSave();
        return;
    }
    if (!isDirty) return;
    isDirty = false;
    isWriting = true;
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
        isWriting = false;
        if (err) {
            console.error('数据库写入失败:', err);
            // 即使失败也不影响游戏进行，下次会重试
        }
        if (isDirty) scheduleSave();
    });
}

function saveDb() {
    isDirty = true;
    scheduleSave();
}

// 进程退出前强制同步写入，避免丢数据
function flushDbSync() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('同步写入失败:', e);
    }
}

process.on('SIGINT', () => { flushDbSync(); process.exit(0); });
process.on('SIGTERM', () => { flushDbSync(); process.exit(0); });
process.on('uncaughtException', (err) => { console.error(err); flushDbSync(); process.exit(1); });

let onlineUsers = {}; 
let flyingTimers = {}; 
let testOnlineUsers = {}; 
let testFlyingTimers = {}; 

// 定期（200ms）同步所有飞行用户的能量到大屏
setInterval(() => {
    const energyUpdates = {};
    
    const collectEnergy = (timers) => {
        for (let socketId in timers) {
            const flightInfo = timers[socketId];
            if (!flightInfo) continue;
            
            const elapsed = Date.now() - flightInfo.startTime;
            const energyDrained = Math.floor((elapsed / CONFIG.drainInterval) * CONFIG.drainRate);
            const currentEnergy = Math.max(0, flightInfo.initialEnergy - energyDrained);
            
            energyUpdates[socketId] = {
                energy: currentEnergy,
                maxEnergy: CONFIG.totalEnergy,
                energyPercent: (currentEnergy / CONFIG.totalEnergy)
            };
        }
    };

    collectEnergy(flyingTimers);
    collectEnergy(testFlyingTimers);
    
    // 只有当有飞行中的用户时才发送
    if (Object.keys(energyUpdates).length > 0) {
        io.to('screen_room').emit('energy_sync', energyUpdates);
    }
}, 200); 

// --- API ---
app.get('/api/data', (req, res) => res.json(db));
app.get('/api/settings', (req, res) => {
    res.json(db.settings);
});

app.post('/api/settings', (req, res) => {
    const { randomAvatars } = req.body;
    db.settings = { ...db.settings, randomAvatars };
    isDirty = true;
    scheduleSave();
    io.emit('settingsChange', db.settings);
    res.json({ success: true, settings: db.settings });
});

app.post('/api/prizes', (req, res) => {
    db.prizes = req.body;
    saveDb();
    io.to('screen_room').emit('config_updated', db.prizes);
    res.json({success:true});
});
app.post('/api/users', (req, res) => {
    // 验证身份证后8位唯一性
    const newUsers = req.body;
    const idCards = newUsers.map(u => u.idCard);
    const duplicates = idCards.filter((id, index) => idCards.indexOf(id) !== index);
    if(duplicates.length > 0) {
        return res.json({success:false, error: `身份证后8位冲突: ${duplicates.join(', ')}`});
    }

    // 检测被清空历史的用户，通知大屏移除，并恢复库存
    const resetUsers = [];
    newUsers.forEach(nu => {
        const oldUser = db.users.find(u => u.idCard === nu.idCard);
        if(oldUser && oldUser.history && oldUser.history.length > 0 && (!nu.history || nu.history.length === 0)) {
            resetUsers.push({ idCard: nu.idCard, name: nu.name });
            // 恢复该用户的中奖库存
            oldUser.history.forEach(h => {
                const prize = db.prizes.find(p => p.name === h.prize);
                if (prize) {
                    prize.stock++;
                }
            });
            console.log(`检测到用户重置: ${nu.name} (${nu.idCard})`);
        }
    });

    db.users = newUsers;
    saveDb();

    // 通知大屏移除被重置的用户头像
    resetUsers.forEach(u => {
        console.log(`发送 user_reset 事件到 screen_room: ${u.idCard}`);
        io.to('screen_room').emit('user_reset', { idCard: u.idCard });
    });

    res.json({success:true});
});

app.post('/api/reset-game', (req, res) => {
    // 重置前：计算每个奖品被中的次数，加回库存
    db.users.forEach(u => {
        if (u.history && u.history.length > 0) {
            u.history.forEach(h => {
                const prize = db.prizes.find(p => p.name === h.prize);
                if (prize) {
                    prize.stock++;
                }
            });
        }
    });
    
    // 重置所有用户的能量和历史
    db.users.forEach(u => {
        u.energy = CONFIG.totalEnergy;
        u.history = [];
    });
    saveDb();
    // 关键：通知大屏彻底清空视觉
    io.emit('force_reload'); 
    io.to('screen_room').emit('reset_all_visuals');
    res.json({success:true});
});

// --- 压力测试逻辑 ---
app.post('/api/stress-test', (req, res) => {
    const { userCount, durationSeconds } = req.body;
    console.log(`开始压力测试: ${userCount}人, 时长${durationSeconds}秒`);

    // 1. 创建临时测试用户（不写入数据库）
    const testUsers = [];
    for(let i=0; i<userCount; i++) {
        const socketId = `VIRTUAL_${i}`;
        testUsers.push({
            idCard: `TEST${1000+i}`,
            name: `测试员${i}`,
            avatar: 'default.png',
            energy: CONFIG.totalEnergy,
            history: []
        });
    }

    // 2. 创建临时库存副本（用于压力测试）
    const tempPrizeStock = {};
    db.prizes.forEach(p => {
        tempPrizeStock[p.id] = parseInt(p.stock, 10) || 0;
    });

    // 3. 模拟用户登录和行为
    for(let i=0; i<userCount; i++) {
        const socketId = `VIRTUAL_${i}`;
        const u = testUsers[i];
        
        // 随机延迟让用户登录（体现真实的用户到达时间）
        const loginDelay = Math.random() * durationSeconds * 1000 * 0.3;
        
        setTimeout(() => {
            // 模拟用户登录
            testOnlineUsers[socketId] = u;
            io.to('screen_room').emit('user_online', u);
            
            // 登录后，80%的概率在随机延迟后启动游戏，20%只登录不玩
            if (Math.random() < 0.8) {
                const playDelay = Math.random() * 3000 + 500; // 0.5-3.5秒后启动
                
                setTimeout(() => {
                    // 模拟启动游戏
                    const startTime = Date.now();
                    testFlyingTimers[socketId] = { startTime, initialEnergy: u.energy };
                    io.to('screen_room').emit('player_launch', { id: socketId, avatar: u.avatar, idCard: u.idCard });
                    
                    // 根据新逻辑，在10秒后能量耗尽（能量10000，每100ms减150）
                    const gameEndTime = 10000 + Math.random() * 3000; // 10-13秒游戏时长
                    
                    setTimeout(() => {
                        // 能量耗尽，结算游戏
                        delete testFlyingTimers[socketId];
                        
                        // 从库存>0的奖品中选择（使用临时库存副本）
                        const availablePrizes = db.prizes.filter(p => (tempPrizeStock[p.id] || 0) > 0);
                        let resultPrize = { id: -1, name: "谢谢参与", color: "#666" };
                        
                        if (availablePrizes.length > 0) {
                            // 预处理权重，确保安全
                            const weights = availablePrizes.map(p => parseInt(p.weight) || 0);
                            const totalWeight = weights.reduce((sum, w) => sum + w, 0);
                            
                            if (totalWeight > 0) {
                                let random = Math.random() * totalWeight;
                                for (let i = 0; i < availablePrizes.length; i++) {
                                    random -= weights[i];
                                    // 使用 <= 0 判断命中，解决边界问题
                                    if (random <= 0) { 
                                        resultPrize = availablePrizes[i]; 
                                        break; 
                                    }
                                }
                                // 兜底逻辑：防止浮点数精度问题导致未命中，强制选中最后一个
                                if (resultPrize.id === -1) {
                                    resultPrize = availablePrizes[availablePrizes.length - 1];
                                }
                            }
                        }
                        
                        // 临时库存扣除（但不写入db）
                        if (resultPrize.id !== -1) {
                            tempPrizeStock[resultPrize.id] = Math.max(0, (tempPrizeStock[resultPrize.id] || 0) - 1);
                        }
                        
                        // 压力测试不记录到db，仅前端显示
                        if (resultPrize.id === -1) {
                            io.to('screen_room').emit('player_pause', { id: socketId, user: u });
                        } else {
                            io.to('screen_room').emit('player_land', { id: socketId, prize: resultPrize, user: u });
                        }
                        delete testOnlineUsers[socketId];
                    }, gameEndTime);
                }, playDelay);
            }
        }, loginDelay);
    }
    
    res.json({success:true});
});

// --- Socket ---
io.on('connection', (socket) => {
    socket.on('screen_join', () => {
        socket.join('screen_room');
        const allHistory = [];
        db.users.forEach(u => {
            if(u.history && u.history.length > 0) allHistory.push({ user: u, prizeName: u.history[0].prize });
        });
        const realWaitingUsers = Object.values(onlineUsers)
            .map(uid => db.users.find(u => u.idCard === uid))
            .filter(u => u && !flyingTimers[getSocketIdByUserId(u.idCard)] && u.history.length === 0);

        const testWaitingUsers = Object.entries(testOnlineUsers)
            .filter(([sid, u]) => u && !testFlyingTimers[sid])
            .map(([, u]) => u);

        const waitingUsers = realWaitingUsers.concat(testWaitingUsers);

        socket.emit('init_screen', { prizes: db.prizes, winners: allHistory, waitingUsers: waitingUsers });
    });

    socket.on('login', ({ idCard }) => {
        const user = db.users.find(u => u.idCard === idCard);
        if (!user) return socket.emit('login_fail', '无此身份');
        onlineUsers[socket.id] = idCard;
        if (user.history && user.history.length > 0) {
            socket.emit('login_success', user);
            setTimeout(() => { socket.emit('game_result', { prize: { name: user.history[0].prize }, isReplay: true }); }, 200);
            return;
        }
        socket.emit('login_success', user);
        if (!flyingTimers[socket.id]) io.to('screen_room').emit('user_online', user);
    });

    // 客户端请求增加能量（固定 +300），服务器端统一计算并返回同步状态
    socket.on('add_energy', () => {
        const userId = onlineUsers[socket.id];
        const user = db.users.find(u => u.idCard === userId);
        if (!user) return;

        // 如果正在飞行，需要重新计算当前能量（考虑衰减），然后增加 300
        let isFlying = false;
        let newStartTime = Date.now();
        if (flyingTimers[socket.id]) {
            isFlying = true;
            const flightInfo = flyingTimers[socket.id];
            const elapsed = Date.now() - flightInfo.startTime;
            const energyDrained = Math.floor((elapsed / CONFIG.drainInterval) * CONFIG.drainRate);
            const currentEnergy = Math.max(0, flightInfo.initialEnergy - energyDrained);
            user.energy = Math.min(currentEnergy + 300, CONFIG.totalEnergy);

            // 重置飞行计时器，从新的能量值重新开始计时
            flightInfo.startTime = Date.now();
            flightInfo.initialEnergy = user.energy;
            newStartTime = flightInfo.startTime;
        } else {
            // 未在飞行，直接增加 300（防止客户端发送的值不可信）
            user.energy = Math.min((user.energy || 0) + 300, CONFIG.totalEnergy);
        }

        saveDb();

        socket.emit('engine_status', { flying: !!isFlying, energy: user.energy, startTime: newStartTime, initialEnergy: user.energy, drainRate: CONFIG.drainRate, drainInterval: CONFIG.drainInterval });
    });

    socket.on('start_engine', () => {
        const userId = onlineUsers[socket.id];
        const user = db.users.find(u => u.idCard === userId);
        if (!user || user.energy <= 0 || flyingTimers[socket.id]) return;
        
        // 记录启动时间，客户端将自行计算能量衰减
        const startTime = Date.now();
        flyingTimers[socket.id] = { startTime, initialEnergy: user.energy };
        
        socket.emit('engine_status', { flying: true, startTime, initialEnergy: user.energy, drainRate: CONFIG.drainRate, drainInterval: CONFIG.drainInterval });
        io.to('screen_room').emit('player_launch', { id: socket.id, avatar: user.avatar, idCard: user.idCard });
    });

    socket.on('stop_engine', () => {
        const userId = onlineUsers[socket.id];
        const user = db.users.find(u => u.idCard === userId);
        if (!flyingTimers[socket.id] || (user && user.history.length > 0)) return;
        
        // 计算最终能量：初始能量 - 衰减
        const flightInfo = flyingTimers[socket.id];
        const elapsed = Date.now() - flightInfo.startTime;
        const energyDrained = Math.floor((elapsed / CONFIG.drainInterval) * CONFIG.drainRate);
        user.energy = Math.max(0, flightInfo.initialEnergy - energyDrained);
        saveDb();
        
        // 直接调用 stopAndSettle 来生成游戏结果
        stopAndSettle(socket.id, user);
    });

    socket.on('disconnect', () => {
        const userId = onlineUsers[socket.id];
        if (userId) {
            if(flyingTimers[socket.id]) {
                const user = db.users.find(u => u.idCard === userId);
                // 计算最终能量
                const flightInfo = flyingTimers[socket.id];
                const elapsed = Date.now() - flightInfo.startTime;
                const energyDrained = Math.floor((elapsed / CONFIG.drainInterval) * CONFIG.drainRate);
                user.energy = Math.max(0, flightInfo.initialEnergy - energyDrained);
                
                delete flyingTimers[socket.id];
                saveDb();
                io.to('screen_room').emit('player_pause', { id: socket.id, user: user });
            } else {
                io.to('screen_room').emit('user_offline', { id: socket.id });
            }
            delete onlineUsers[socket.id];
        }
    });
});

function getSocketIdByUserId(uid) { return Object.keys(onlineUsers).find(key => onlineUsers[key] === uid); }

function stopAndSettle(socketId, user) {
    if(!flyingTimers[socketId]) return;
    delete flyingTimers[socketId];

    const availablePrizes = db.prizes.filter(p => p.stock > 0);
    let resultPrize = { id: -1, name: "宇宙尘埃", color: "#666" };
    if (availablePrizes.length > 0) {
        let totalWeight = availablePrizes.reduce((sum, p) => sum + parseInt(p.weight), 0);
        let random = Math.random() * totalWeight;
        for (let p of availablePrizes) {
            random -= p.weight;
            if (random <= 0) { resultPrize = p; break; }
        }
    }
    if (resultPrize.id !== -1) {
        const pIndex = db.prizes.findIndex(p => p.id === resultPrize.id);
        if (pIndex > -1) db.prizes[pIndex].stock--;
    }
    const winTime = new Date().toLocaleString();
    user.history.push({ prize: resultPrize.name, time: winTime });
    
    // 开奖后将能量设置为0
    user.energy = 0;
    
    saveDb();
    io.to(socketId).emit('game_result', { prize: resultPrize, leftEnergy: 0, isReplay: false });
    if (resultPrize.id === -1) {
        // 无库存：头像回到底部
        io.to('screen_room').emit('player_pause', { id: socketId, user: user });
    } else {
        io.to('screen_room').emit('player_land', { id: socketId, prize: resultPrize, user: user });
    }
}

http.listen(PORT, () => console.log('Final Engine v4 Ready.'));