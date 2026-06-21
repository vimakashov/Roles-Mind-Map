import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Select, InputLabel, FormControl, OutlinedInput,
  Chip, Stack, Typography, Popper, Paper, ClickAwayListener,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import type { Character, RelationEntry } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  others: Character[];
  value: RelationEntry[];
  onCancel: () => void;
  onSave: (entries: RelationEntry[]) => void;
}

interface Picker { entryIndex: number; targetId: string; anchor: HTMLElement }

export function RelationsModal({ open, others, value, onCancel, onSave }: Props) {
  const [entries, setEntries] = useState<RelationEntry[]>(value);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);

  useEffect(() => { if (open) setEntries(value); }, [open]);

  const update = (i: number, patch: Partial<RelationEntry>) =>
    setEntries((e) => e.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : id;
  };

  const setColor = (entryIndex: number, targetId: string, color: string) =>
    setEntries((es) =>
      es.map((e, i) =>
        i === entryIndex
          ? { ...e, targets: e.targets.map((t) => (t.id === targetId ? { ...t, color } : t)) }
          : e,
      ),
    );

  const openPicker = (entryIndex: number, targetId: string, anchor: HTMLElement) => {
    const cur = entries[entryIndex].targets.find((t) => t.id === targetId)?.color ?? EDGE_COLOR;
    setDraft(cur);
    setPicker({ entryIndex, targetId, anchor });
  };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;

  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    if (!picker) return;
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(picker.entryIndex, picker.targetId, next);
  };

  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v) && picker) setColor(picker.entryIndex, picker.targetId, v);
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
                  helperText="Необязательно"
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
                  value={entry.targets.map((t) => t.id)}
                  input={<OutlinedInput label="Связь" />}
                  onChange={(e) => {
                    const ids = typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : e.target.value;
                    update(i, {
                      targets: ids.map(
                        (id) => entry.targets.find((t) => t.id === id) ?? { id, color: null },
                      ),
                    });
                  }}
                  renderValue={(ids) => (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {ids.map((id) => <Chip key={id} label={nameOf(id)} size="small" />)}
                    </Box>
                  )}
                >
                  {others.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{`${o.firstName} ${o.lastName ?? ""}`.trim()}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {entry.targets.length > 0 && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">Цвета линий</Typography>
                  {entry.targets.map((t) => (
                    <Stack
                      key={t.id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography variant="body2">{nameOf(t.id)}</Typography>
                      <IconButton
                        aria-label={`цвет линии для ${nameOf(t.id)}`}
                        onClick={(ev) => openPicker(i, t.id, ev.currentTarget)}
                      >
                        <Box sx={{
                          width: 22, height: 22, borderRadius: "50%",
                          bgcolor: t.color ?? EDGE_COLOR, border: "1px solid #ccc",
                        }} />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>
        <Button sx={{ mt: 2 }} onClick={() => setEntries((e) => [...e, { role: "", targets: [] }])}>
          + Добавить связь
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(entries)}>Сохранить</Button>
      </DialogActions>

      <Popper open={!!picker} anchorEl={picker?.anchor ?? null} placement="bottom" sx={{ zIndex: 1400 }}>
        <ClickAwayListener onClickAway={() => setPicker(null)}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <Wheel
              color={hexToHsva(validDraft)}
              onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })}
            />
            <ShadeSlider
              hsva={hexToHsva(validDraft)}
              style={{ width: 210 }}
              onChange={(s) => applyHsva(s)}
            />
            <TextField
              label="HEX"
              size="small"
              value={draft}
              onChange={(e) => onHexInput(e.target.value)}
              sx={{ width: 210 }}
            />
          </Paper>
        </ClickAwayListener>
      </Popper>
    </Dialog>
  );
}
