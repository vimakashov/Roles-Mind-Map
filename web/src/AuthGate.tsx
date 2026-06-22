import { useEffect, useState, type ReactNode } from "react";
import { Box, CircularProgress } from "@mui/material";
import { api } from "./api/client.js";
import { AuthScreen } from "./screens/AuthScreen.js";
import type { AuthUser } from "./types.js";

export function AuthGate({ children }: { children: ReactNode }) {
  // undefined = checking, null = anonymous, AuthUser = signed in
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (user === null) return <AuthScreen onAuthenticated={setUser} />;
  return <>{children}</>;
}
