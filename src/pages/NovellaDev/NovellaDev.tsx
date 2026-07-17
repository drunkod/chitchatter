import { useMemo, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { VisualNovelSessionState } from "../../models/visualNovel";
import { VisualNovelEngine } from "../../services/visualNovel";
import { bundledStories } from "../../stories/catalog";

const localControllerId = "local-dev";

const sceneBackgrounds: Record<string, string> = {
  pier: "linear-gradient(145deg, #081b2b 0%, #102f47 55%, #8c704e 140%)",
  "beacon-ending":
    "radial-gradient(circle at 70% 25%, #ffd978 0%, #9a6637 18%, #10263c 55%, #06111e 100%)",
  "dawn-ending":
    "linear-gradient(155deg, #f7c68a 0%, #d88974 35%, #597594 70%, #152b42 100%)",
};

const createSessionId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}`;
};

export const NovellaDev = () => {
  const story = bundledStories[0];
  const engine = useMemo(
    () => new VisualNovelEngine(story, { now: () => Date.now() }),
    [story],
  );
  const [state, setState] = useState<VisualNovelSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setError(null);
    setState(engine.start(createSessionId(), localControllerId));
  };

  const apply = (operation: () => VisualNovelSessionState) => {
    try {
      setError(null);
      setState(operation());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The story could not continue",
      );
    }
  };

  if (!state) {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
        <Paper elevation={8} sx={{ overflow: "hidden" }}>
          <Box
            sx={{
              minHeight: 240,
              p: { xs: 3, sm: 5 },
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              color: "common.white",
              background: sceneBackgrounds.pier,
            }}
          >
            <Typography variant="overline" sx={{ opacity: 0.8 }}>
              Novella M1 playground
            </Typography>
            <Typography variant="h2" component="h1" sx={{ fontWeight: 800 }}>
              {story.title}
            </Typography>
          </Box>
          <Stack spacing={2} sx={{ p: { xs: 3, sm: 4 } }}>
            <Typography>{story.description}</Typography>
            <Typography color="text.secondary" variant="body2">
              Local-only preview. No room transport or persistence is attached
              in M1. The synchronized room version arrives in M2.
            </Typography>
            <Button variant="contained" size="large" onClick={start}>
              Start story
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const scene = engine.getScene(state);
  const entry = engine.getEntry(state);
  const choices = engine.getAvailableChoices(state);
  const ended = engine.isAtEnd(state);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
      <Paper elevation={10} sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            minHeight: { xs: 300, sm: 430 },
            p: { xs: 3, sm: 5 },
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "common.white",
            background: sceneBackgrounds[scene.id] ?? sceneBackgrounds.pier,
          }}
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={story.title} size="small" />
            <Chip label={`Scene: ${scene.id}`} size="small" />
            <Chip label={`Revision: ${state.revision}`} size="small" />
          </Stack>

          <Paper
            elevation={0}
            sx={{
              mt: 8,
              p: { xs: 2.5, sm: 3.5 },
              color: "text.primary",
              backgroundColor: "rgba(255, 255, 255, 0.94)",
              backdropFilter: "blur(8px)",
            }}
          >
            {entry.speaker && (
              <Typography
                variant="overline"
                color="primary"
                sx={{ fontWeight: 800 }}
              >
                {entry.speaker}
              </Typography>
            )}
            <Typography variant="h5" component="p" sx={{ mt: 0.5 }}>
              {entry.text}
            </Typography>
          </Paper>
        </Box>

        <Stack spacing={2} sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          {choices.map((choice) => (
            <Button
              key={choice.id}
              variant="contained"
              size="large"
              onClick={() => apply(() => engine.choose(state, choice.id))}
            >
              {choice.label}
            </Button>
          ))}

          {choices.length === 0 && engine.canAdvance(state) && (
            <Button
              variant="contained"
              size="large"
              onClick={() => apply(() => engine.advance(state))}
            >
              Continue
            </Button>
          )}

          {ended && (
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="h5">The End</Typography>
              <Typography color="text.secondary" variant="body2">
                This preview lives only in memory, matching the MVP cutline.
              </Typography>
              <Button
                variant="contained"
                onClick={() => apply(() => engine.restart(state))}
              >
                Read again
              </Button>
            </Stack>
          )}

          {error && <Typography color="error">{error}</Typography>}

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button variant="text" onClick={() => setState(null)}>
              Back to lobby
            </Button>
            <Box sx={{ flex: 1 }} />
            <Typography color="text.secondary" variant="caption">
              Session {state.sessionId}
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
};
