export type AgeStage = "child" | "teen" | "adult" | "old";

export function ageStage(age: number | null | undefined): AgeStage {
  if (age == null) return "adult";
  if (age <= 10) return "child";
  if (age <= 17) return "teen";
  if (age <= 50) return "adult";
  return "old";
}
