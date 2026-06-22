import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { TopBar } from "../components/TopBar.js";
import { MindMap } from "../canvas/MindMap.js";
import { CharacterView } from "../components/CharacterView.js";
import { api } from "../api/client.js";
import type { BookGraph, Character } from "../types.js";

export function ShareScreen() {
  const { bookId } = useParams();
  const [graph, setGraph] = useState<BookGraph>({ title: "", nodes: [], edges: [] });
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [selected, setSelected] = useState<Character | null>(null);

  useEffect(() => {
    api.getSharedGraph(bookId!)
      .then((g) => { setGraph(g); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [bookId]);

  const avatarUrl = useCallback(
    (id: string, version: string) => api.sharedAvatarUrl(bookId!, id, version),
    [bookId],
  );

  if (status === "error") {
    return (
      <Box sx={{ minHeight: "100dvh" }}>
        <TopBar />
        <Box sx={{ minHeight: "70dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
          <Typography variant="h6" color="text.secondary">Ссылка недействительна</Typography>
        </Box>
      </Box>
    );
  }

  const empty = status === "ok" && graph.nodes.length === 0;

  return (
    <Box sx={{ minHeight: "100dvh", position: "relative" }}>
      <TopBar title={graph.title} />
      {empty ? (
        <Box sx={{ minHeight: "70dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="h5" color="text.secondary">Персонажей пока нет</Typography>
        </Box>
      ) : status === "ok" ? (
        <Box sx={{ position: "absolute", top: 56, left: 0, right: 0, bottom: 0 }}>
          <MindMap
            graph={graph}
            avatarUrl={avatarUrl}
            onNodeTap={(id) => {
              const c = graph.nodes.find((n) => n.id === id);
              if (c) setSelected(c);
            }}
            onNodeMoved={() => {}}
          />
        </Box>
      ) : null}

      {selected && (
        <CharacterView
          open
          character={selected}
          graph={graph}
          avatarUrl={avatarUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </Box>
  );
}
