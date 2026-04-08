/**
 * Neko Health Clinic Configuration
 *
 * Each clinic can be configured with either:
 * - placeId: Google Place ID (ChIJ... format) — fastest, most accurate
 * - googleMapsUrl: Full Google Maps URL — Place ID extracted automatically
 * - searchQuery: Text query for Google Places Text Search API — used as fallback
 *
 * Add new clinics here. If a clinic has no placeId/googleMapsUrl, the ingestion
 * job will use the Text Search API to find it automatically.
 */

export interface ClinicConfig {
  name: string;
  country: string;
  city: string;
  address?: string;
  placeId?: string;
  googleMapsUrl?: string;
  searchQuery: string; // always required as fallback
}

export const NEKO_CLINICS: ClinicConfig[] = [
  {
    name: "Neko Health Marylebone",
    country: "GB",
    city: "London",
    searchQuery: "Neko Health Marylebone London",
  },
  {
    name: "Neko Health Spitalfields",
    country: "GB",
    city: "London",
    address: "1 Lamb Street, London, E1 6EA",
    searchQuery: "Neko Health Spitalfields London",
  },
  {
    name: "Neko Health Manchester",
    country: "GB",
    city: "Manchester",
    searchQuery: "Neko Health Manchester",
  },
  {
    name: "Neko Health Covent Garden",
    country: "GB",
    city: "London",
    searchQuery: "Neko Health Covent Garden London",
  },
  {
    name: "Neko Health Birmingham",
    country: "GB",
    city: "Birmingham",
    address: "10 Livery Street, Birmingham, B3 2NU",
    searchQuery: "Neko Health 10 Livery Street Birmingham",
  },
  {
    name: "Neko Health Victoria",
    country: "GB",
    city: "London",
    searchQuery: "Neko Health Victoria London",
  },
  {
    name: "Neko Health Östermalm",
    country: "SE",
    city: "Stockholm",
    searchQuery: "Neko Health Östermalmstorg Stockholm",
  },
];
