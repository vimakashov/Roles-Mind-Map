import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, MenuItem, Menu, Stack, Typography, Popper, Paper, ClickAwayListener,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import { LinkChoiceDialog } from "./LinkChoiceDialog.js";
import { sortForPicker } from "../lib/sortCharacters.js";
import type { Character, RelationConnection } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  others: Character[];
  value: RelationConnection[];
  onCancel: () => void;
  onSave: (connections: RelationConnection[]) => void;
  onCreateNew?: (rows: RelationConnection[]) => void;
}

interface Picker { otherId: string; anchor: HTMLElement }

export function RelationsModal({ open, others, value, onCancel, onSave, onCreateNew }: Props) {
  const [rows, setRows] = useState<RelationConnection[]>(value);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { if (open) setRows(value); }, [open]);

  useBackClose(open, onCancel);
  useBackClose(!!picker, () => setPicker(null));
  useBackClose(menuOpen, () => { setMenuOpen(false); setAddAnchor(null); });

  const nameOf = (id: string) => {
    const c = others.find((o) => o.id === id);
    return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : id;
  };

  const connectedIds = new Set(rows.map((r) => r.otherId));
  const available = sortForPicker(others.filter((o) => !connectedIds.has(o.id)));

  const addConnection = (otherId: string) => {
    setRows((rs) => [...rs, { otherId, role: "", color: null }]);
    setMenuOpen(false);
    setAddAnchor(null);
  };
  const removeRow = (otherId: string) => setRows((rs) => rs.filter((r) => r.otherId !== otherId));
  const setRole = (otherId: string, role: string) =>
    setRows((rs) => rs.map((r) => (r.otherId === otherId ? { ...r, role } : r)));
  const setColor = (otherId: string, color: string) =>
    setRows((rs) => rs.map((r) => (r.otherId === otherId ? { ...r, color } : r)));

  const openPicker = (otherId: string, anchor: HTMLElement) => {
    setDraft(rows.find((r) => r.otherId === otherId)?.color ?? EDGE_COLOR);
    setPicker({ otherId, anchor });
  };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;
  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    if (!picker) return;
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(picker.otherId, next);
  };
  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v) && picker) setColor(picker.otherId, v);
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связи</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Связь общая для пары персонажей. Роль — симметричная метка (например «друзья», «семья»).
        </Typography>
        <Stack spacing={2}>
          {rows.map((row) => (
            <Box key={row.otherId} sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{nameOf(row.otherId)}</Typography>
                <IconButton
                  aria-label={`цвет линии для ${nameOf(row.otherId)}`}
                  onClick={(ev) => openPicker(row.otherId, ev.currentTarget)}
                >
                  <Box sx={{
                    width: 22, height: 22, borderRadius: "50%",
                    bgcolor: row.color ?? EDGE_COLOR, border: "1px solid #ccc",
                  }} />
                </IconButton>
                <IconButton
                  aria-label={`удалить связь с ${nameOf(row.otherId)}`}
                  onClick={() => removeRow(row.otherId)}
                >
                  <DeleteIcon />
                </IconButton>
              </Stack>
              <TextField
                label="Роль"
                value={row.role}
                inputProps={{ maxLength: 30 }}
                helperText="Необязательно"
                onChange={(e) => setRole(row.otherId, e.target.value)}
                fullWidth
                sx={{ mt: 2 }}
              />
            </Box>
          ))}
        </Stack>
        <Button sx={{ mt: 2 }} onClick={(e) => { setAddAnchor(e.currentTarget); setChoiceOpen(true); }}>
          + Добавить связь
        </Button>
        <Menu anchorEl={addAnchor} open={menuOpen}
          onClose={() => { setMenuOpen(false); setAddAnchor(null); }}>
          {available.map((o) => (
            <MenuItem key={o.id} onClick={() => addConnection(o.id)}>
              {`${o.firstName} ${o.lastName ?? ""}`.trim()}
            </MenuItem>
          ))}
        </Menu>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => onSave(rows)}>Сохранить</Button>
      </DialogActions>

      <Popper open={!!picker} anchorEl={picker?.anchor ?? null} placement="bottom" sx={{ zIndex: 1400 }}>
        <ClickAwayListener onClickAway={() => setPicker(null)}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <Wheel color={hexToHsva(validDraft)} onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })} />
            <ShadeSlider hsva={hexToHsva(validDraft)} style={{ width: 210 }} onChange={(s) => applyHsva(s)} />
            <TextField label="HEX" size="small" value={draft} onChange={(e) => onHexInput(e.target.value)} sx={{ width: 210 }} />
          </Paper>
        </ClickAwayListener>
      </Popper>
      <LinkChoiceDialog
        open={choiceOpen}
        canUseExisting={available.length > 0}
        onExisting={() => { setChoiceOpen(false); setMenuOpen(true); }}
        onCreateNew={() => { setChoiceOpen(false); setAddAnchor(null); onCreateNew?.(rows); }}
        onCancel={() => { setChoiceOpen(false); setAddAnchor(null); }}
      />
    </Dialog>
  );
}
