import { describe, expect, it } from "vitest";
import {
  TACTIC_IDS,
  type FormationKind,
  type GamePhase,
  type PlayerId,
} from "../../game-core/src";
import { TROOP_COLORS } from "../../game-core/src/types";
import { ACTIVE_CONTENT_PACK, tacticContentName, troopContentName } from ".";

describe("M16-A original content pack", () => {
  it("covers every stable mechanic identifier without changing rules", () => {
    expect(ACTIVE_CONTENT_PACK.ruleset.troopColors).toEqual(TROOP_COLORS);
    expect(ACTIVE_CONTENT_PACK.ruleset.tacticIds).toEqual(TACTIC_IDS);
    expect(Object.keys(ACTIVE_CONTENT_PACK.troopColors).sort()).toEqual(
      [...TROOP_COLORS].sort(),
    );
    expect(Object.keys(ACTIVE_CONTENT_PACK.tactics).sort()).toEqual(
      [...TACTIC_IDS].sort(),
    );
  });

  it("provides complete player, formation and phase terminology", () => {
    const players: PlayerId[] = ["player-one", "player-two"];
    const formations: FormationKind[] = [
      "wedge",
      "phalanx",
      "battalion",
      "skirmish",
      "host",
    ];
    const phases: GamePhase[] = [
      "setup",
      "play-card",
      "resolve-tactic",
      "optional-claims",
      "draw-card",
      "finished",
    ];

    for (const player of players) {
      expect(ACTIVE_CONTENT_PACK.players[player].name).not.toHaveLength(0);
      expect(ACTIVE_CONTENT_PACK.players[player].sigil).toHaveLength(1);
      expect(ACTIVE_CONTENT_PACK.players[player].accent).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    }
    for (const formation of formations)
      expect(ACTIVE_CONTENT_PACK.formations[formation].name).not.toHaveLength(
        0,
      );
    for (const phase of phases)
      expect(ACTIVE_CONTENT_PACK.phases[phase]).not.toHaveLength(0);
  });

  it("keeps legacy mechanic ids out of visible names", () => {
    for (const id of TACTIC_IDS) {
      expect(tacticContentName(id)).toBeTruthy();
      expect(tacticContentName(id)).not.toContain("tactic-");
    }
    for (const color of TROOP_COLORS) {
      expect(troopContentName(color)).toBeTruthy();
      expect(troopContentName(color)).not.toBe(color);
    }
  });

  it("provides a distinct sigil and valid accent for every visual family", () => {
    const troopSigils = TROOP_COLORS.map(
      (color) => ACTIVE_CONTENT_PACK.troopColors[color].sigil,
    );
    expect(new Set(troopSigils).size).toBe(TROOP_COLORS.length);
    for (const color of TROOP_COLORS) {
      expect(ACTIVE_CONTENT_PACK.troopColors[color].accent).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
    }
    for (const theme of Object.values(
      ACTIVE_CONTENT_PACK.tacticCategoryThemes,
    )) {
      expect(theme.sigil).toHaveLength(1);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(ACTIVE_CONTENT_PACK.theme.cssVariables["--main-menu-art"]).toBe(
      "url('/main-menu-art.jpg')",
    );
  });
});
