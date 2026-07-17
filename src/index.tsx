import "./polyfills";
import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "typeface-roboto";

import "modern-normalize/modern-normalize.css";
import "./index.css";

import { ThemeProvider, createTheme } from "@mui/material/styles";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";

import Init from "./Init";
import reportWebVitals from "./reportWebVitals";

const NovellaDev = lazy(() =>
  import("./pages/NovellaDev").then((module) => ({
    default: module.NovellaDev,
  })),
);

// NOTE: This is a workaround for MUI components attempting to access theme code
// before it has loaded.
// See: https://stackoverflow.com/a/76017295/470685
<ThemeProvider theme={createTheme()} />;

// NOTE: This is a workaround for SyntaxHighlighter not working reliably in the
// EmbedCodeDialog component. It seems to have the effect of warming some
// sort of internal cache that avoids a race condition within
// SyntaxHighlighter.
// See: https://github.com/react-syntax-highlighter/react-syntax-highlighter/issues/513
ReactDOM.createRoot(document.createElement("div")).render(
  <SyntaxHighlighter language="" children={""} />,
);

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
const queryParams = new URLSearchParams(window.location.search);
const showNovellaDev =
  import.meta.env.VITE_ENABLE_NOVELLA_DEV === "true" &&
  queryParams.get("novellaDev") === "1";

root.render(
  showNovellaDev ? (
    <Suspense fallback={<div>Loading novella preview…</div>}>
      <NovellaDev />
    </Suspense>
  ) : (
    <Init />
  ),
);

// If you want to start measuring performance in the app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
