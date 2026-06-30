import type { LucideIcon } from "lucide-react";
import {
  User,
  CreditCard,
  Pill,
  Building2,
  Phone,
  ClipboardCheck,
  Mail,
  MapPin,
} from "lucide-react";
import type { Profile } from "../lib/types.ts";

export interface Category {
  id: string;
  label: string;
  icon: LucideIcon;
  required: boolean;
  fields: (keyof Profile)[];
}

export const SAMPLE: Profile = {
  name: "Jordan Avery Reyes",
  dob: "1989-03-14",
  phone: "(303) 555-0147",
  email: "jordan.reyes@email.com",
  address: "412 Birchwood Ln, Lakewood, CO 80214",
  insurer: "Anthem Blue Cross Blue Shield",
  memberId: "ABC7741920",
  groupNo: "GRP-55821",
  pharmacy: "Walgreens — 6th & Wadsworth",
  allergies: "Penicillin, latex",
  medications: "Lisinopril 10 mg, Atorvastatin 20 mg",
  emergencyName: "Sam Reyes",
  emergencyPhone: "(303) 555-0182",
  reason: "Annual physical",
};

export const EMPTY: Profile = {
  name: "", dob: "", phone: "", email: "", address: "",
  insurer: "", memberId: "", groupNo: "", pharmacy: "",
  allergies: "", medications: "", emergencyName: "", emergencyPhone: "", reason: "",
};

export const CATEGORIES: Category[] = [
  { id: "identity",  label: "Identity",                icon: User,           required: true,  fields: ["name", "dob", "phone", "email", "address"] },
  { id: "insurance", label: "Insurance",               icon: CreditCard,     required: false, fields: ["insurer", "memberId", "groupNo"] },
  { id: "meds",      label: "Medications & allergies", icon: Pill,           required: false, fields: ["allergies", "medications"] },
  { id: "pharmacy",  label: "Pharmacy",                icon: Building2,      required: false, fields: ["pharmacy"] },
  { id: "emergency", label: "Emergency contact",       icon: Phone,          required: false, fields: ["emergencyName", "emergencyPhone"] },
  { id: "reason",    label: "Reason for visit",        icon: ClipboardCheck, required: false, fields: ["reason"] },
];

export const LABELS: Record<keyof Profile, string> = {
  name: "Full name",      dob: "Date of birth",       phone: "Phone",
  email: "Email",         address: "Address",          insurer: "Insurer",
  memberId: "Member ID",  groupNo: "Group #",          pharmacy: "Preferred pharmacy",
  allergies: "Allergies", medications: "Medications",  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency phone",                   reason: "Reason for visit",
};

export const FIELD_ICON: Partial<Record<keyof Profile, LucideIcon>> = {
  phone: Phone, email: Mail, address: MapPin, emergencyPhone: Phone,
};
