# Lucky Draw System (抽奖系统)

A high-performance, real-time lottery system designed for large-scale events and parties. Built with Node.js and Socket.io for millisecond-level synchronization between the big screen and mobile controllers.

专为大型活动和年会设计的高性能实时抽奖系统。基于 Node.js 和 Socket.io 构建，实现大屏与手机控制端的毫秒级同步。

## ✨ Key Highlights (核心亮点)

### 🚀 Performance & Stability (极致性能 & 稳定性)
- **Zero-Latency Sync**: Powered by `Socket.io` to ensure the big screen spins instantly when the trigger is pressed.
- **Battle-Tested**: Stability-first architecture. Optimized for high concurrency to ensure 100% reliability during live events.
- **Robust Architecture**: Essential features only, stripping away unstable experimental effects for maximum peace of mind.
- **零延迟同步**：基于 `Socket.io` 驱动，确保按下触发器时大屏瞬间响应。
- **久经考验**：稳定性优先的架构。经过高并发优化，确保现场活动 100% 可靠。

### � Interactive Gameplay & Features (特色玩法 & 功能)
- **Vertical Typography**: Big screen optimized for Chinese prize names using vertical layout (perfect for long titles).
- **Mobile Feedback**: The mobile controller features haptic feedback, ripples, and particle explosions (`click-spark`) for a game-like interactive feel.
- **Smart Avatar Handling**: Global toggle to replace default avatars with random real-person photos, making the wheel look more lively even without user uploads.
- **垂直排版**：大屏针对中文奖品名称进行了垂直排版优化（非常适合长标题）。
- **手机端交互**：手机控制器具有触觉反馈、波纹和粒子爆炸效果，带来游戏般的互动手感。
- **智能头像处理**：后台全局开关，可将默认头像替换为随机真人照片，即使没有上传头像也能保证大屏效果丰富生动。

### 🛡️ Secure Admin Control (安全后台)
- **Configurable Security**: Admin path is defined in `server.js` (`ADMIN_ROUTE`) and should be changed for production security.
- **Floating UI**: Modern, non-intrusive floating control panel for easy status monitoring.
- **Emergency Tools**: Built-in "Stress Test" and "Reset" tools for pre-show checks.
- **可配置安全性**：后台路径在 `server.js` 中定义 (`ADMIN_ROUTE`)，生产环境建议修改以确保安全。
- **悬浮 UI**：现代、非侵入式的悬浮控制面板，便于状态监控。
- **应急工具**：内置“压力测试”和“重置”工具，用于活动前检查。

## 🛠️ Technology Stack (技术栈)
- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Frontend**: Vanilla JS (ES6+), CSS3 Animations, Canvas API
- **Data**: JSON-based lightweight persistence (`db.json`)

## 📦 Installation & Setup (安装与部署)

1. **Clone the repository (克隆仓库)**
   ```bash
   git clone https://github.com/wyfang/Annual-Gala-Big-Wheel.git
   cd Annual-Gala-Big-Wheel
   ```

2. **Install dependencies (安装依赖)**
   ```bash
   npm install
   ```

3. **Start the server (启动服务器)**
   ```bash
   node server.js
   # Or using PM2 for production (或者使用 PM2 生产环境运行)
   pm2 start server.js --name lucky-draw
   ```

4. **Access the system (访问系统)**
   - **Big Screen (大屏端)**: `http://<server-ip>:3000/`
   - **Mobile Controller (手机控端)**: `http://<server-ip>:3000/mobile.html`
   - **Admin Panel (管理后台)**: `http://<server-ip>:3000/admin` (Default path, configure in `server.js` / 默认路径，请在 server.js 中修改)

## 📂 Project Structure (目录结构)

```text
├── public/
│   ├── index.html       # Big screen display (Canvas wheel / 大屏显示)
│   ├── mobile.html      # Mobile remote controller (手机遥控器)
│   └── style.css        # Global styles (全局样式)
├── secure_admin/        # Protected admin resources (受保护的后台资源)
│   └── admin.html       # Control panel (控制面板)
├── server.js            # Main application entry (主程序入口)
├── db.json              # Data store (数据存储)
├── package.json
└── README.md
```
