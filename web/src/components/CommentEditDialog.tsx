import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";

interface Props {
  open: boolean;
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}

export function CommentEditDialog({ open, initialText, onCancel, onSave }: Props) {
  const [text, setText] = useState(initialText);

  useEffect(() => { if (open) setText(initialText); }, [open]);
  useBackClose(open, onCancel);

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Комментарий</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          multiline
          minRows={8}
          fullWidth
          value={text}
          inputProps={{ maxLength: 2000 }}
          onChange={(e) => setText(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" disabled={!text.trim()} onClick={() => onSave(text)}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
