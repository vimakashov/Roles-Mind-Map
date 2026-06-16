import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Select, InputLabel, FormControl, OutlinedInput, Chip, Stack, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import type { Character, RelationEntry } from "../types.js";

interface Props {
  open: boolean;
  others: Character[];
  value: RelationEntry[];
  onCancel: () => void;
  onSave: (entries: RelationEntry[]) => void;
}

export function RelationsModal({ open, others, value, onCancel, onSave }: Props) {
  const [entries, setEntries] = useState<RelationEntry[]>(value);

  useEffect(() => { if (open) setEntries(value); }, [open]);

  const update = (i: number, patch: Partial<RelationEntry>) =>
    setEntries((e) => e.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName}` : id;
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связи</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          «Я — [роль] для выбранных». Например: роль «сын» → Пётр, Жанна.
        </Typography>
        <Stack spacing={2}>
          {entries.map((entry, i) => (
            <Box key={i} sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Роль"
                  value={entry.role}
                  inputProps={{ maxLength: 30 }}
                  onChange={(e) => update(i, { role: e.target.value })}
                  fullWidth
                />
                <IconButton
                  aria-label="удалить связь"
                  onClick={() => setEntries((e) => e.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel id={`tgt-${i}`}>Связь</InputLabel>
                <Select
                  labelId={`tgt-${i}`}
                  multiple
                  value={entry.targetIds}
                  input={<OutlinedInput label="Связь" />}
                  onChange={(e) =>
                    update(i, {
                      targetIds: typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value,
                    })
                  }
                  renderValue={(ids) => (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {ids.map((id) => <Chip key={id} label={nameOf(id)} size="small" />)}
                    </Box>
                  )}
                >
                  {others.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{o.firstName} {o.lastName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          ))}
        </Stack>
        <Button sx={{ mt: 2 }} onClick={() => setEntries((e) => [...e, { role: "", targetIds: [] }])}>
          + Добавить связь
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(entries)}>Сохранить</Button>
      </DialogActions>
    </Dialog>
  );
}
