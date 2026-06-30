export interface Office {
  id: string;
  name: string;
}

export const OFFICES: Office[] = [
  { id: "demo", name: "Carry Demo Clinic" },
  { id: "north", name: "Northside Family Practice" },
  { id: "harbor", name: "Harbor Pediatrics" },
];

export function getOffice(id: string): Office | undefined {
  return OFFICES.find((office) => office.id === id);
}
