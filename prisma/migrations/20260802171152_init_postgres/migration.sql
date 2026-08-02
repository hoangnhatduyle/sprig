-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompassPosition" AS ENUM ('SOUTH', 'NORTH');

-- CreateEnum
CREATE TYPE "BaselineLight" AS ENUM ('PARTIAL_SHADE', 'FULL_SUN');

-- CreateEnum
CREATE TYPE "CellStatus" AS ENUM ('EMPTY', 'PLANTED', 'GERMINATED', 'GROWING', 'HARVESTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CellWaterState" AS ENUM ('DRY', 'WET');

-- CreateEnum
CREATE TYPE "RainBarrelStatus" AS ENUM ('EMPTY', 'PARTIAL', 'FULL', 'OVERFLOWING');

-- CreateEnum
CREATE TYPE "RainBarrelEventType" AS ENUM ('ADD_WATER', 'REACH_CAPACITY', 'OVERFLOW', 'RAIN_STOP', 'DRAW_WATER');

-- CreateEnum
CREATE TYPE "IrrigationSystemStatus" AS ENUM ('IDLE', 'RUNNING');

-- CreateEnum
CREATE TYPE "SolarLightStatus" AS ENUM ('CHARGING', 'READY', 'ILLUMINATED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "SimulationRunStatus" AS ENUM ('DRAFT', 'CONFIGURED', 'RUNNING', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GrowthHabit" AS ENUM ('UPRIGHT_BUSH', 'VINING', 'ROSETTE_LEAFY', 'ROOT_CROP');

-- CreateEnum
CREATE TYPE "PollinationDependency" AS ENUM ('SELF', 'WIND', 'INSECT');

-- CreateEnum
CREATE TYPE "PhenologyStage" AS ENUM ('GERMINATING', 'VEGETATIVE', 'FLOWERING', 'FRUITING', 'MATURE', 'SENESCENT', 'DEAD');

-- CreateEnum
CREATE TYPE "WeatherSource" AS ENUM ('PROCEDURAL', 'REAL_API');

-- CreateEnum
CREATE TYPE "ConditionOverrideKind" AS ENUM ('SHADE_CLOTH', 'GROW_LIGHT', 'RAIN_COVER');

-- CreateEnum
CREATE TYPE "CareActionType" AS ENUM ('MULCH', 'COMPOST', 'FERTILIZER', 'WEEDING', 'FUNGICIDE', 'PESTICIDE', 'PREDATOR_RELEASE');

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthFt" INTEGER NOT NULL DEFAULT 4,
    "lengthFt" INTEGER NOT NULL DEFAULT 8,
    "gridCols" INTEGER NOT NULL,
    "gridRows" INTEGER NOT NULL,
    "compassPosition" "CompassPosition" NOT NULL,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "species" TEXT,
    "waterNeed" TEXT,
    "lightNeed" TEXT,
    "isCompanionPlanting" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "seedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "seedUnit" TEXT NOT NULL DEFAULT 'seed',
    "imageFilename" TEXT,
    "imageMimeType" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "speciesProfileId" TEXT,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridCell" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "column" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "status" "CellStatus" NOT NULL DEFAULT 'EMPTY',
    "baselineLight" "BaselineLight" NOT NULL,
    "plantedAt" TIMESTAMP(3),
    "waterState" "CellWaterState" NOT NULL DEFAULT 'DRY',

    CONSTRAINT "GridCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellPlanting" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "plantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "seedQuantityUsed" DOUBLE PRECISION,
    "seedUnit" TEXT,

    CONSTRAINT "CellPlanting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestRecord" (
    "id" TEXT NOT NULL,
    "cellPlantingId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "harvestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "HarvestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridCellEvent" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "eventType" "CellStatus" NOT NULL,
    "plantId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "GridCellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedRenovation" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "previousCols" INTEGER NOT NULL,
    "previousRows" INTEGER NOT NULL,
    "newCols" INTEGER NOT NULL,
    "newRows" INTEGER NOT NULL,

    CONSTRAINT "BedRenovation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RainBarrel" (
    "id" TEXT NOT NULL,
    "capacityGallons" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "currentGallons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "linkedDownspout" TEXT,
    "status" "RainBarrelStatus" NOT NULL DEFAULT 'EMPTY',

    CONSTRAINT "RainBarrel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RainBarrelEvent" (
    "id" TEXT NOT NULL,
    "barrelId" TEXT NOT NULL,
    "eventType" "RainBarrelEventType" NOT NULL,
    "amountGallons" DOUBLE PRECISION NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RainBarrelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrrigationSystem" (
    "id" TEXT NOT NULL,
    "dailyStartTime" TEXT NOT NULL DEFAULT '08:00',
    "durationMinutes" INTEGER NOT NULL DEFAULT 10,
    "waterSource" TEXT NOT NULL DEFAULT 'SPIGOT_ASSUMED',
    "status" "IrrigationSystemStatus" NOT NULL DEFAULT 'IDLE',

    CONSTRAINT "IrrigationSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrrigationRun" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "IrrigationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GardenLocation" (
    "id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GardenLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarLight" (
    "id" TEXT NOT NULL,
    "bedId" TEXT,
    "chargeLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SolarLightStatus" NOT NULL DEFAULT 'CHARGING',

    CONSTRAINT "SolarLight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "status" "SimulationRunStatus" NOT NULL DEFAULT 'DRAFT',
    "waterInput" TEXT,
    "simulatedTime" TIMESTAMP(3),
    "affectedCells" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "growthHabit" "GrowthHabit" NOT NULL,
    "baseTempC" DOUBLE PRECISION NOT NULL,
    "gddToGerminate" DOUBLE PRECISION NOT NULL,
    "gddToVegetative" DOUBLE PRECISION NOT NULL,
    "gddToFlowering" DOUBLE PRECISION NOT NULL,
    "gddToFruiting" DOUBLE PRECISION NOT NULL,
    "gddToMaturity" DOUBLE PRECISION NOT NULL,
    "heatStressThresholdC" DOUBLE PRECISION NOT NULL,
    "coldStressThresholdC" DOUBLE PRECISION NOT NULL,
    "droughtComfortFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "matureHeightCm" DOUBLE PRECISION NOT NULL,
    "canopyWidthCm" DOUBLE PRECISION NOT NULL,
    "primaryColor" TEXT NOT NULL,
    "isFallbackDefault" BOOLEAN NOT NULL DEFAULT false,
    "lightNeedFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "baseNutrientDemand" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "windLodgingThresholdKph" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "pollinationDependency" "PollinationDependency" NOT NULL DEFAULT 'SELF',
    "diseaseResistanceTrait" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SpeciesProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimClockEpoch" (
    "id" TEXT NOT NULL,
    "realAnchorAt" TIMESTAMP(3) NOT NULL,
    "simAnchorAt" TIMESTAMP(3) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimClockEpoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonBoundary" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "SeasonBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherDay" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tempHighC" DOUBLE PRECISION NOT NULL,
    "tempLowC" DOUBLE PRECISION NOT NULL,
    "precipitationMm" DOUBLE PRECISION NOT NULL,
    "cloudCoverPct" DOUBLE PRECISION NOT NULL,
    "humidityPct" DOUBLE PRECISION NOT NULL,
    "windSpeedKph" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "source" "WeatherSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoilProfile" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "sandPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "siltPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "clayPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "fieldCapacityFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "wiltingPointFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.12,

    CONSTRAINT "SoilProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellEnvironmentState" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "soilMoistureFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "soilTempC" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "nitrogenPoolFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "phosphorusPoolFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "potassiumPoolFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "calciumPoolFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "micronutrientIndexFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "residueOrganicMatterPool" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mulchDepthMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysNearSaturation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weedPressureFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedThroughDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CellEnvironmentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantingBiologyState" (
    "id" TEXT NOT NULL,
    "cellPlantingId" TEXT NOT NULL,
    "accumulatedGdd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "phenologyStage" "PhenologyStage" NOT NULL DEFAULT 'GERMINATING',
    "leafFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "stemFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "rootFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "flowerFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fruitFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storedReserves" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "waterContentIndex" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "cumulativeStress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dominantStressDial" TEXT,
    "updatedThroughDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantingBiologyState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedConditionOverride" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "kind" "ConditionOverrideKind" NOT NULL,
    "intensity" DOUBLE PRECISION NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "BedConditionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiseaseInfection" (
    "id" TEXT NOT NULL,
    "cellPlantingId" TEXT NOT NULL,
    "diseaseKey" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedThroughDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiseaseInfection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PestPopulation" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "pestKey" TEXT NOT NULL,
    "population" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedThroughDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PestPopulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredatorPopulation" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "predatorKey" TEXT NOT NULL,
    "population" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedThroughDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredatorPopulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareActionEvent" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "cellId" TEXT,
    "actionType" "CareActionType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT,

    CONSTRAINT "CareActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalNote" (
    "id" TEXT NOT NULL,
    "bedId" TEXT,
    "cellId" TEXT,
    "body" TEXT,
    "photoFilename" TEXT,
    "photoMimeType" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_IrrigationSystemBeds" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_IrrigationSystemBeds_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bed_name_key" ON "Bed"("name");

-- CreateIndex
CREATE INDEX "Plant_archivedAt_idx" ON "Plant"("archivedAt");

-- CreateIndex
CREATE INDEX "Plant_speciesProfileId_idx" ON "Plant"("speciesProfileId");

-- CreateIndex
CREATE INDEX "GridCell_bedId_idx" ON "GridCell"("bedId");

-- CreateIndex
CREATE UNIQUE INDEX "GridCell_bedId_column_row_key" ON "GridCell"("bedId", "column", "row");

-- CreateIndex
CREATE INDEX "CellPlanting_cellId_idx" ON "CellPlanting"("cellId");

-- CreateIndex
CREATE INDEX "CellPlanting_plantId_idx" ON "CellPlanting"("plantId");

-- CreateIndex
CREATE INDEX "HarvestRecord_cellPlantingId_harvestedAt_idx" ON "HarvestRecord"("cellPlantingId", "harvestedAt");

-- CreateIndex
CREATE INDEX "HarvestRecord_plantId_harvestedAt_idx" ON "HarvestRecord"("plantId", "harvestedAt");

-- CreateIndex
CREATE INDEX "GridCellEvent_cellId_idx" ON "GridCellEvent"("cellId");

-- CreateIndex
CREATE INDEX "GridCellEvent_plantId_idx" ON "GridCellEvent"("plantId");

-- CreateIndex
CREATE INDEX "BedRenovation_bedId_idx" ON "BedRenovation"("bedId");

-- CreateIndex
CREATE INDEX "RainBarrelEvent_barrelId_idx" ON "RainBarrelEvent"("barrelId");

-- CreateIndex
CREATE INDEX "IrrigationRun_systemId_startedAt_idx" ON "IrrigationRun"("systemId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesProfile_key_key" ON "SpeciesProfile"("key");

-- CreateIndex
CREATE INDEX "SpeciesProfile_isFallbackDefault_idx" ON "SpeciesProfile"("isFallbackDefault");

-- CreateIndex
CREATE INDEX "SimClockEpoch_realAnchorAt_idx" ON "SimClockEpoch"("realAnchorAt");

-- CreateIndex
CREATE INDEX "SeasonBoundary_startedAt_idx" ON "SeasonBoundary"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherDay_date_key" ON "WeatherDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SoilProfile_bedId_key" ON "SoilProfile"("bedId");

-- CreateIndex
CREATE UNIQUE INDEX "CellEnvironmentState_cellId_key" ON "CellEnvironmentState"("cellId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantingBiologyState_cellPlantingId_key" ON "PlantingBiologyState"("cellPlantingId");

-- CreateIndex
CREATE INDEX "BedConditionOverride_bedId_removedAt_idx" ON "BedConditionOverride"("bedId", "removedAt");

-- CreateIndex
CREATE INDEX "DiseaseInfection_cellPlantingId_resolvedAt_idx" ON "DiseaseInfection"("cellPlantingId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PestPopulation_bedId_pestKey_key" ON "PestPopulation"("bedId", "pestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PredatorPopulation_bedId_predatorKey_key" ON "PredatorPopulation"("bedId", "predatorKey");

-- CreateIndex
CREATE INDEX "CareActionEvent_bedId_occurredAt_idx" ON "CareActionEvent"("bedId", "occurredAt");

-- CreateIndex
CREATE INDEX "CareActionEvent_cellId_occurredAt_idx" ON "CareActionEvent"("cellId", "occurredAt");

-- CreateIndex
CREATE INDEX "JournalNote_bedId_occurredAt_idx" ON "JournalNote"("bedId", "occurredAt");

-- CreateIndex
CREATE INDEX "JournalNote_cellId_occurredAt_idx" ON "JournalNote"("cellId", "occurredAt");

-- CreateIndex
CREATE INDEX "JournalNote_occurredAt_idx" ON "JournalNote"("occurredAt");

-- CreateIndex
CREATE INDEX "_IrrigationSystemBeds_B_index" ON "_IrrigationSystemBeds"("B");

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_speciesProfileId_fkey" FOREIGN KEY ("speciesProfileId") REFERENCES "SpeciesProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridCell" ADD CONSTRAINT "GridCell_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellPlanting" ADD CONSTRAINT "CellPlanting_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "GridCell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellPlanting" ADD CONSTRAINT "CellPlanting_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_cellPlantingId_fkey" FOREIGN KEY ("cellPlantingId") REFERENCES "CellPlanting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridCellEvent" ADD CONSTRAINT "GridCellEvent_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "GridCell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GridCellEvent" ADD CONSTRAINT "GridCellEvent_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedRenovation" ADD CONSTRAINT "BedRenovation_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RainBarrelEvent" ADD CONSTRAINT "RainBarrelEvent_barrelId_fkey" FOREIGN KEY ("barrelId") REFERENCES "RainBarrel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrrigationRun" ADD CONSTRAINT "IrrigationRun_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "IrrigationSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilProfile" ADD CONSTRAINT "SoilProfile_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellEnvironmentState" ADD CONSTRAINT "CellEnvironmentState_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "GridCell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantingBiologyState" ADD CONSTRAINT "PlantingBiologyState_cellPlantingId_fkey" FOREIGN KEY ("cellPlantingId") REFERENCES "CellPlanting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedConditionOverride" ADD CONSTRAINT "BedConditionOverride_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseInfection" ADD CONSTRAINT "DiseaseInfection_cellPlantingId_fkey" FOREIGN KEY ("cellPlantingId") REFERENCES "CellPlanting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PestPopulation" ADD CONSTRAINT "PestPopulation_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredatorPopulation" ADD CONSTRAINT "PredatorPopulation_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareActionEvent" ADD CONSTRAINT "CareActionEvent_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareActionEvent" ADD CONSTRAINT "CareActionEvent_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "GridCell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalNote" ADD CONSTRAINT "JournalNote_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalNote" ADD CONSTRAINT "JournalNote_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "GridCell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IrrigationSystemBeds" ADD CONSTRAINT "_IrrigationSystemBeds_A_fkey" FOREIGN KEY ("A") REFERENCES "Bed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IrrigationSystemBeds" ADD CONSTRAINT "_IrrigationSystemBeds_B_fkey" FOREIGN KEY ("B") REFERENCES "IrrigationSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

