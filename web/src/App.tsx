import { ThemeProvider, CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { theme } from "./theme.js";
import { AuthGate } from "./AuthGate.js";
import { BooksScreen } from "./screens/BooksScreen.js";
import { BookScreen } from "./screens/BookScreen.js";
import { ShareScreen } from "./screens/ShareScreen.js";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/share/:bookId" element={<ShareScreen />} />
          <Route path="/" element={<AuthGate><BooksScreen /></AuthGate>} />
          <Route path="/books/:bookId" element={<AuthGate><BookScreen /></AuthGate>} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
