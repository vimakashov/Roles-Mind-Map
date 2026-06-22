import { useEffect, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, IconButton, Stack, Typography, Popper, Paper, ClickAwayListener,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex } from "@uiw/react-color";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { api } from "../api/client.js";
import type { Relationship } from "../types.js";
import { EDGE_COLOR } from "../theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
  open: boolean;
  relationship: Relationship;
  sourceName: string;
  targetName: string;
  onCancel: () => void;
  onChanged: () => void;
}

export function RelationEditModal({ open, relationship, sourceName, targetName, onCancel, onChanged }: Props) {
  const [role, setRole] = useState(relationship.role);
  const [color, setColor] = useState<string | null>(relationship.color ?? null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(EDGE_COLOR);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) { setRole(relationship.role); setColor(relationship.color ?? null); }
  }, [open, relationship]);

  useBackClose(open, onCancel);
  useBackClose(!!anchor, () => setAnchor(null));

  const openPicker = (el: HTMLElement) => { setDraft(color ?? EDGE_COLOR); setAnchor(el); };

  const validDraft = HEX.test(draft) ? draft : EDGE_COLOR;
  const applyHsva = (patch: { h?: number; s?: number; v?: number }) => {
    const next = hsvaToHex({ ...hexToHsva(validDraft), ...patch });
    setDraft(next);
    setColor(next);
  };
  const onHexInput = (v: string) => {
    setDraft(v);
    if (HEX.test(v)) setColor(v);
  };

  const save = async () => {
    await api.updateRelation(relationship.id, { role: role.trim(), color });
    onChanged();
  };
  const remove = async () => {
    await api.deleteRelation(relationship.id);
    onChanged();
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Связь</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Связь общая для пары персонажей. Роль — симметричная метка (например «друзья», «семья»).
        </Typography>
        <Box sx={{ p: 2, border: "1px solid #eee", borderRadius: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>{`${sourceName} — ${targetName}`}</Typography>
            <IconButton aria-label="цвет линии" onClick={(ev) => openPicker(ev.currentTarget)}>
              <Box sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: color ?? EDGE_COLOR, border: "1px solid #ccc" }} />
            </IconButton>
            <IconButton aria-label="удалить связь" onClick={() => setConfirmOpen(true)}>
              <DeleteIcon />
            </IconButton>
          </Stack>
          <TextField
            label="Роль"
            value={role}
            inputProps={{ maxLength: 30 }}
            helperText="Необязательно"
            onChange={(e) => setRole(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={() => void save()}>Сохранить</Button>
      </DialogActions>

      <Popper open={!!anchor} anchorEl={anchor} placement="bottom" sx={{ zIndex: 1400 }}>
        <ClickAwayListener onClickAway={() => setAnchor(null)}>
          <Paper sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
            <Wheel color={hexToHsva(validDraft)} onChange={(c) => applyHsva({ h: c.hsva.h, s: c.hsva.s })} />
            <ShadeSlider hsva={hexToHsva(validDraft)} style={{ width: 210 }} onChange={(s) => applyHsva(s)} />
            <TextField label="HEX" size="small" value={draft} onChange={(e) => onHexInput(e.target.value)} sx={{ width: 210 }} />
          </Paper>
        </ClickAwayListener>
      </Popper>

      <ConfirmDialog
        open={confirmOpen}
        title="Удалить связь?"
        message="Связь между персонажами будет удалена. Это действие необратимо."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); void remove(); }}
      />
    </Dialog>
  );
}
