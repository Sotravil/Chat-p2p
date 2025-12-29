# Chat P2P - Serverless Real-Time Chat

![Preview](preview.png)

A modern, open-source peer-to-peer chat application with **no backend required**. Send messages, voice notes, images, and files using GitHub as storage. Built with a mobile-first approach, completely secure, and 100% free.

🔗 **Live Demo:** [https://sotravil.github.io/Chat-p2p/](https://sotravil.github.io/Chat-p2p/)

## ✨ Features

- 💬 **Peer-to-Peer Messaging** - Direct communication between users
- 🎙️ **Voice Notes** - Send audio messages
- 📷 **Image Sharing** - Share images instantly
- 📁 **File Transfer** - Send and receive files
- 🔒 **Secure** - No server-side storage of messages
- 📱 **Mobile-First Design** - Optimized for smartphones and tablets
- 🌐 **Serverless Architecture** - Uses GitHub as the storage backend
- 🎨 **Modern UI** - Beautiful dark theme with gradient accents
- ⚡ **Real-Time Updates** - Instant message synchronization
- 🆓 **Completely Free** - No costs, no subscriptions

## 🚀 How It Works

Chat P2P leverages GitHub's infrastructure as a storage layer:
1. Messages are stored as GitHub commits/files
2. Clients poll for updates in real-time
3. No traditional server needed
4. All communication happens through GitHub API

## 🛠️ Technologies

- **Pure HTML/CSS/JavaScript** - No build tools required
- **GitHub API** - For storage and synchronization
- **WebRTC** - For peer-to-peer connections (optional)
- **Progressive Web App (PWA)** - Installable on mobile devices

## 📦 Getting Started

### Quick Start

1. Visit [https://sotravil.github.io/Chat-p2p/](https://sotravil.github.io/Chat-p2p/)
2. Set up your GitHub token (for storage)
3. Start chatting!

### Local Development

```bash
# Clone the repository
git clone https://github.com/Sotravil/Chat-p2p.git
cd Chat-p2p

# Open in browser
# Simply open index.html or cp2pv2.html in your web browser
# Or use a local server:
python -m http.server 8000
# Then visit http://localhost:8000
```

No build process or dependencies needed!

## 📁 Project Structure

```
Chat-p2p/
├── index.html      # Main chat application
├── cp2pv2.html     # Alternative version
├── favicon.ico     # App icon
├── preview.png     # Preview image
└── README.md       # This file
```

## 🔧 Configuration

The app requires a GitHub Personal Access Token for storage:

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Generate a new token with `repo` scope
3. Enter the token in the app settings

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. 🐛 Report bugs
2. 💡 Suggest new features
3. 🔧 Submit pull requests
4. 📖 Improve documentation
5. ⭐ Star the repository

### Development Guidelines

- Keep the code simple and readable
- Maintain the mobile-first approach
- Test on multiple devices
- Follow existing code style
- Update documentation

## 🤖 GitHub Copilot

This project supports GitHub Copilot! Check out [COPILOT_GUIDE.md](COPILOT_GUIDE.md) to learn how to use Copilot's agent capabilities to automatically edit files and make improvements.

## 🔒 Privacy & Security

- **No Server Storage** - Messages aren't stored on any central server
- **GitHub-Based** - Uses your own GitHub account for storage
- **Open Source** - All code is auditable
- **Client-Side** - Everything runs in your browser

## 📱 Browser Support

- ✅ Chrome/Edge (90+)
- ✅ Firefox (88+)
- ✅ Safari (14+)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 📄 License

This project is open source. Feel free to use, modify, and distribute.

## 👤 Author

**Sotravil**

- GitHub: [@Sotravil](https://github.com/Sotravil)

## ⭐ Show Your Support

Give a ⭐ if you like this project!

## 🐛 Known Issues

Check the [Issues](https://github.com/Sotravil/Chat-p2p/issues) page for current bugs and feature requests.

## 📮 Feedback

Have questions or suggestions? Open an issue or reach out!

---

**Made with ❤️ by Sotravil**
