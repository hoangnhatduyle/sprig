import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { resetGrowthTables } from "@/domain/growth/test-db";
import { applyPesticideToBed, releasePredatorsToBed } from "./pest-action-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-JOURNAL-001.yaml (AC-5)

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGrowthTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetGrowthTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

describe("pest-action-service CareActionEvent recording", () => {
  it("T-SPEC-JOURNAL-001-AC-AC_5-pesticide: applyPesticideToBed writes a bed-scoped PESTICIDE CareActionEvent (cellId null)", async () => {
    const bed = await seedBed(prisma, { name: "Pest Bed", compassPosition: "SOUTH" });
    await prisma.pestPopulation.create({ data: { bedId: bed.id, pestKey: "aphid", population: 10 } });

    await applyPesticideToBed(prisma, { bedId: bed.id, pestKey: "aphid", broadSpectrum: false });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "PESTICIDE" } });
    expect(events).toHaveLength(1);
    expect(events[0].cellId).toBeNull();
    expect(JSON.parse(events[0].detail ?? "{}")).toMatchObject({ pestKey: "aphid", broadSpectrum: false });
  });

  it("T-SPEC-JOURNAL-001-AC-AC_5-predator-release: releasePredatorsToBed writes a bed-scoped PREDATOR_RELEASE CareActionEvent", async () => {
    const bed = await seedBed(prisma, { name: "Predator Bed", compassPosition: "SOUTH" });

    await releasePredatorsToBed(prisma, { bedId: bed.id, predatorKey: "ladybug", amount: 2 });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "PREDATOR_RELEASE" } });
    expect(events).toHaveLength(1);
    expect(events[0].cellId).toBeNull();
  });
});
