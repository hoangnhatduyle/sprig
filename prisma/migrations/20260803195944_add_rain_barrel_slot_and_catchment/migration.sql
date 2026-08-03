-- AlterTable
ALTER TABLE "RainBarrel" ADD COLUMN     "catchmentAreaSqFt" DOUBLE PRECISION NOT NULL DEFAULT 300,
ADD COLUMN     "yardSlot" INTEGER;

-- Seeds the 2 fixed rain barrels the GLB model expects (RainBarrel_1_*/
-- RainBarrel_2_* node groups, docs/Sprig3Dv2.glb) — same reasoning as
-- 20260803104500_seed_default_beds for the 2 fixed beds: the 3D scene has an
-- exactly-2 fixed physical layout, and yardSlot is the only identifier that
-- maps a RainBarrel row to which node group it drives (there's no bed
-- relation to key off; the barrels sit beside the beds, not inside either
-- one). Table is empty pre-migration (confirmed before writing this), so the
-- yardSlot column is added nullable-then-backfilled rather than requiring a
-- default for a NOT NULL add.
INSERT INTO "RainBarrel" ("id", "yardSlot", "capacityGallons", "currentGallons", "catchmentAreaSqFt", "status")
VALUES
  (gen_random_uuid()::text, 1, 50, 0, 300, 'EMPTY'),
  (gen_random_uuid()::text, 2, 50, 0, 300, 'EMPTY')
ON CONFLICT DO NOTHING;

-- AlterTable: enforce NOT NULL + uniqueness now that every row has a slot.
ALTER TABLE "RainBarrel" ALTER COLUMN "yardSlot" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RainBarrel_yardSlot_key" ON "RainBarrel"("yardSlot");
