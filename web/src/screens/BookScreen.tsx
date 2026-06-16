import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { api, type CharacterInput } from "../api/client.js";
import type { BookGraph, Character } from "../types.js";
import { TopBar } from "../components/TopBar.js";
import { AddFab } from "../components/AddFab.js";
import { CharacterModal } from "../components/CharacterModal.js";
import { MindMap } from "../canvas/MindMap.js";
import { groupEdges } from "../lib/relations.js";

export function BookScreen() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<BookGraph>({ nodes: [], edges: [] });
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; character?: Character } | null>(null);

  const refresh = () => api.getGraph(bookId!).then((g) => { setGraph(g); setLoaded(true); });
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [bookId]);

  const others = useMemo(
    () => graph.nodes.filter((n) => n.id !== modal?.character?.id),
    [graph.nodes, modal],
  );

  const initial: CharacterInput | undefined = modal?.character && {
    gender: modal.character.gender,
    firstName: modal.character.firstName,
    lastName: modal.character.lastName,
    middleName: modal.character.middleName ?? "",
    age: modal.character.age ?? null,
    relations: groupEdges(modal.character.id, graph.edges),
  };

  const submit = async (input: CharacterInput) => {
    if (modal?.mode === "edit" && modal.character) {
      await api.updateCharacter(modal.character.id, input);
    } else {
      await api.createCharacter(bookId!, input);
    }
    setModal(null);
    await refresh();
  };

  const remove = async () => {
    if (modal?.character) await api.deleteCharacter(modal.character.id);
    setModal(null);
    await refresh();
  };

  const empty = loaded && graph.nodes.length === 0;

  return (
    <Box sx={{ minHeight: "100dvh", position: "relative" }}>
      <TopBar onBack={() => navigate("/")} />
      {empty ? (
        <Box sx={{ minHeight: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Typography variant="h5">Персонажей пока нет</Typography>
          <Button variant="contained" size="large" onClick={() => setModal({ mode: "create" })}>
            Добавить персонажа
          </Button>
        </Box>
      ) : (
        <Box sx={{ position: "absolute", top: 56, left: 0, right: 0, bottom: 0 }}>
          <MindMap
            graph={graph}
            onNodeTap={(id) => {
              const character = graph.nodes.find((n) => n.id === id);
              if (character) setModal({ mode: "edit", character });
            }}
            onNodeMoved={(id, x, y) => { void api.savePosition(id, x, y); }}
          />
        </Box>
      )}

      {!empty && <AddFab label="Добавить персонажа" onClick={() => setModal({ mode: "create" })} />}

      {modal && (
        <CharacterModal
          open
          mode={modal.mode}
          others={others}
          initial={initial}
          onCancel={() => setModal(null)}
          onSubmit={submit}
          onDelete={modal.mode === "edit" ? remove : undefined}
        />
      )}
    </Box>
  );
}
