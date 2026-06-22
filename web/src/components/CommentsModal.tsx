import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Box, IconButton, Stack, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import type { CommentItem } from "../types.js";
import { CommentEditDialog } from "./CommentEditDialog.js";

interface Props {
  open: boolean;
  value: CommentItem[];
  onCancel: () => void;
  onSave: (comments: CommentItem[]) => void;
}

// `null` => editor closed; `{ index: null }` => adding; `{ index: n }` => editing row n.
type Editing = { index: number | null } | null;

function preview(text: string): string {
  const head = text.trim().slice(0, 15);
  return head.length < text.trim().length ? `${head}…` : head;
}

export function CommentsModal({ open, value, onCancel, onSave }: Props) {
  const [rows, setRows] = useState<CommentItem[]>(value);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => { if (open) setRows(value); }, [open]);
  useBackClose(open, onCancel);

  const removeAt = (index: number) =>
    setRows((rs) => rs.filter((_, i) => i !== index));

  const saveEditor = (text: string) => {
    setRows((rs) => {
      if (editing?.index == null) return [...rs, { id: null, text }];
      return rs.map((r, i) => (i === editing.index ? { ...r, text } : r));
    });
    setEditing(null);
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Комментарии</DialogTitle>
      <DialogContent dividers>
        {rows.length === 0 ? (
          <Button onClick={() => setEditing({ index: null })}>Добавить комментарий +</Button>
        ) : (
          <>
            <Stack spacing={1}>
              {rows.map((row, i) => (
                <Stack key={row.id ?? `new-${i}`} direction="row" spacing={1} alignItems="center">
                  <Typography
                    sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                    noWrap
                    onClick={() => setEditing({ index: i })}
                  >
                    {`${i + 1}. ${preview(row.text)}`}
                  </Typography>
                  <IconButton
                    aria-label={`удалить комментарий ${i + 1}`}
                    onClick={() => removeAt(i)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
            <Box>
              <Button sx={{ mt: 2 }} onClick={() => setEditing({ index: null })}>
                + Добавить комментарий
              </Button>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(rows)}>Сохранить</Button>
      </DialogActions>

      <CommentEditDialog
        open={!!editing}
        initialText={editing?.index != null ? rows[editing.index].text : ""}
        onCancel={() => setEditing(null)}
        onSave={saveEditor}
      />
    </Dialog>
  );
}
