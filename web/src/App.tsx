import { ThemeProvider, CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { theme } from "./theme.js";
import { BooksScreen } from "./screens/BooksScreen.js";
import { BookScreen } from "./screens/BookScreen.js";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BooksScreen />} />
          <Route path="/books/:bookId" element={<BookScreen />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
