import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  List, ListItemButton, ListItemText, Typography,
} from "@mui/material";
import { api } from "../api/client.js";
import type { Book } from "../types.js";
import { TopBar } from "../components/TopBar.js";
import { AddFab } from "../components/AddFab.js";
import { useBackClose } from "../lib/useBackClose.js";

export function BooksScreen() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const [title, setTitle] = useState("");

  useEffect(() => {
    api.listBooks().then((b) => { setBooks(b); setLoaded(true); });
  }, []);

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const book = await api.createBook(trimmed);
    setBooks((b) => [...b, book]);
    setTitle("");
    setOpen(false);
  };

  const empty = loaded && books.length === 0;

  return (
    <>
      {loaded && !empty && <TopBar />}
      {!loaded ? null : empty ? (
        <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Typography variant="h4" color="primary">Roles Mind Map</Typography>
          <Button variant="contained" size="large" onClick={() => setOpen(true)}>Добавить книгу</Button>
        </Box>
      ) : (
        <>
          <List sx={{ pb: 10 }}>
            {books.map((b, i) => (
              <ListItemButton key={b.id} onClick={() => navigate(`/books/${b.id}`)}>
                <ListItemText primary={`${i + 1}. ${b.title}`} />
              </ListItemButton>
            ))}
          </List>
          <AddFab label="Добавить книгу" onClick={() => setOpen(true)} />
        </>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Новая книга</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth label="Название" value={title} sx={{ mt: 1 }}
            inputProps={{ maxLength: 60 }} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={add}>Добавить</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
