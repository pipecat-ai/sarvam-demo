import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

// Devanagari for Hindi transcript lines (JetBrains Mono has none); its
// faces are split by unicode-range, so only the scripts on screen load.
import "@fontsource-variable/noto-sans-devanagari"
import "./index.css"
import App from "./App.tsx"

// Dark mode is forced via class="dark" on <html> in index.html — no
// ThemeProvider, so nothing (hotkey or stored preference) can flip it.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
