import { createRoot } from "react-dom/client";
import App from "./App";
import { SourceAccess } from "./SourceAccess";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/restore-access" ? (
    <main className="restore-page">
      <a className="restore-brand" href="/" aria-label="WebM TV — на главную">
        WEBM TV <span>/</span>
      </a>
      <SourceAccess initialOpen />
    </main>
  ) : (
    <App />
  ),
);
