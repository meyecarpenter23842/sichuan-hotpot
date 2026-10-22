-- Modifier options remain the sole authoritative topping records.
-- Opt-in only: existing branch/legacy groups never become sellable by accident.
ALTER TABLE "ModifierGroup" ADD COLUMN "allowStandalone" BOOLEAN NOT NULL DEFAULT false;
