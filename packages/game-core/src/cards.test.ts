import { describe, expect, it } from "vitest";
import { createTroopDeck, parseTroopCard } from "./cards";
import { createSeededRandom, shuffle } from "./random";

describe("troop deck and seeded shuffle", () => {
  it("creates all 60 unique troops", () => {
    const deck = createTroopDeck();
    expect(deck).toHaveLength(60);
    expect(new Set(deck)).toHaveLength(60);
    expect(parseTroopCard("troop-blue-10")).toMatchObject({
      color: "blue",
      value: 10,
    });
  });

  it("repeats the same shuffle for the same seed", () => {
    const deck = createTroopDeck();
    const first = shuffle(deck, createSeededRandom("repeatable"));
    const second = shuffle(deck, createSeededRandom("repeatable"));
    expect(first).toEqual(second);
    expect(shuffle(deck, createSeededRandom("different"))).not.toEqual(first);
  });
});
