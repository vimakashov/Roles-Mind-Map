import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Box, Typography, Divider } from "@mui/material";
import { useBackClose } from "../lib/useBackClose.js";
import { Avatar } from "./Avatar.js";
import { api } from "../api/client.js";
import type { Character, BookGraph, Gender } from "../types.js";

interface Props {
  open: boolean;
  character: Character;
  graph: BookGraph;
  avatarUrl?: (id: string, version: string) => string;
  onClose: () => void;
}

const GENDER_LABEL: Record<Gender, string> = { male: "Мужчина", female: "Женщина" };

export function CharacterView({ open, character, graph, avatarUrl = api.avatarUrl, onClose }: Props) {
  useBackClose(open, onClose);

  const fullName = [character.firstName, character.middleName, character.lastName].filter(Boolean).join(" ");
  const src = character.avatarUpdatedAt ? avatarUrl(character.id, character.avatarUpdatedAt) : null;

  const nameOf = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? [n.firstName, n.lastName].filter(Boolean).join(" ") : id;
  };
  const relations = graph.edges
    .filter((e) => e.sourceId === character.id || e.targetId === character.id)
    .map((e) => {
      const otherId = e.sourceId === character.id ? e.targetId : e.sourceId;
      return { id: e.id, name: nameOf(otherId), role: e.role };
    });
  const comments = character.comments ?? [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Персонаж</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Avatar gender={character.gender} age={character.age ?? null} src={src} deceased={character.deceased} />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">Пол</Typography>
            <Typography>{GENDER_LABEL[character.gender]}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Имя</Typography>
            <Typography>{fullName}</Typography>
          </Box>
          {character.age != null && (
            <Box>
              <Typography variant="caption" color="text.secondary">Возраст</Typography>
              <Typography>{character.age}</Typography>
            </Box>
          )}
          {character.deceased && <Typography color="text.secondary">Умер</Typography>}

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Связи ({relations.length})</Typography>
            {relations.length === 0 ? (
              <Typography color="text.secondary">Нет связей</Typography>
            ) : (
              <Stack spacing={0.5}>
                {relations.map((r) => (
                  <Typography key={r.id}>{r.role ? `${r.name} — ${r.role}` : r.name}</Typography>
                ))}
              </Stack>
            )}
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Комментарии ({comments.length})</Typography>
            {comments.length === 0 ? (
              <Typography color="text.secondary">Нет комментариев</Typography>
            ) : (
              <Stack spacing={1}>
                {comments.map((c, i) => (
                  <Typography key={c.id ?? i} sx={{ whiteSpace: "pre-wrap" }}>{c.text}</Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
