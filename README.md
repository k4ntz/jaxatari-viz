# JAXAtari-Viz

An extensible, web-based visualization dashboard and experiment tracker for JAXAtari and Reinforcement Learning / Evolutionary algorithms. 

This repository has been refactored into a **purely static single-page application (SPA)**. All dynamic python backend features have been stripped out and pre-computed into static JSON files to allow seamless, zero-cost hosting on GitHub Pages.

## Features
- **Fully Static**: Runs entirely in the browser with no backend server required.
- **Interactive Plotly Visualizations**: Progress curves, game score benchmarking against PPO/DQN/Human baselines.
- **Environment Previews**: Animated previews of Atari 2600 game environments.
- **Dark/Light Theme**: Built with React, Vite, TypeScript, and pure CSS design tokens.
- **GitHub Pages Ready**: Optimized for fast static deployment out of the box.

---

## Directory Architecture
```
jaxatari-viz/
├── .github/workflows/   # CI/CD deployment pipeline for GitHub pages
├── frontend/            # React + Vite + TypeScript frontend
│   ├── public/api/      # Pre-exported static JSON data & GIFs
│   ├── src/             # React application source code
│   └── dist/            # Built production static site
```

---

## Quick Start (Local Development)

### 1. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed.

```bash
cd frontend
npm install
```

### 2. Local Preview
You can run the application locally to test the UI using the pre-exported static data.

**Start the Vite Development Server:**
```bash
npm run dev
```

Alternatively, to test the exact production build:
```bash
npm run build
npm run preview
```

Open your browser at [http://localhost:5173](http://localhost:5173) (or the port specified by Vite).

---

## Deployment

This dashboard is designed to be hosted seamlessly on GitHub Pages. For detailed, step-by-step instructions on how to deploy this static site, please refer to [README_DEPLOY.md](README_DEPLOY.md).
