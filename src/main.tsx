import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { SpeedInsights } from "@vercel/speed-insights/react"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
    <SpeedInsights />
  </StrictMode>
)
