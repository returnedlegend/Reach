# Community food-sharing safety and launch limits

**Research checked:** October 17, 2026 (America/Chicago; October 18 UTC). This is product-safety guidance for a development prototype, not legal advice, a food-safety certification, or a claim that Reach or its users comply with applicable law.

## Prototype scope

Keep any initial food-sharing flow limited to free, commercially packaged, shelf-stable groceries. Do not accept homemade, prepared, opened, repackaged, refrigerated, frozen, hot, or otherwise perishable food; infant formula; supplements; alcohol; or products subject to a recall. This deliberately narrow boundary avoids asking a volunteer or the app to judge cooking, refrigeration, transport temperatures, or safe handling.

Require the donor to confirm that each item is unopened, in its original packaging, clean and dry, free of damage, leakage, pests, and visible contamination, and within every printed date. Reject missing, unreadable, altered, or past dates; never let a user change a product label or date. Ask for a photo of the package and its printed ingredients/date, but do not treat a photo or donor attestation as an inspection or guarantee. A recipient should be able to decline any item and should be told to inspect the package and label before use.

Preserve the manufacturer's ingredient and allergen label by sharing food only in its original package. Do not infer “allergen-free,” medical suitability, nutritional quality, or product safety from listing text, images, or a donor's opinion. FDA identifies nine major food allergens: milk, egg, fish, Crustacean shellfish, tree nuts, peanuts, wheat, soybeans, and sesame. Direct recipients to read the complete current package label every time. If a label is missing or unreadable, reject the listing.

## Listing and exchange controls

- Require users to be adults aged 18 or older. Collect only a birth-date/age confirmation needed for this gate, do not expose it in listings, and prevent a minor from creating, messaging, or arranging an exchange. A checkbox is a prototype control, not age verification.
- Hold every listing for human moderation before publication. Moderators should reject out-of-scope food, recalled products, incomplete labels or dates, unsafe packaging, prohibited content, precise residential addresses, and claims of medical or allergen safety. Provide a report and takedown path and remove listings when the donor reports an issue.
- Show only an approximate pickup area publicly. Reveal a precise public pickup place only after the two adults agree to an exchange, and prefer staffed community locations with permission from the site operator. Do not publish home addresses, personal phone numbers, or private messages. Do not promise that any location is open, supervised, accessible, or safe.
- Keep private notes private to their author and the intended exchange participants. Explain what is shared and with whom before sending. Limit staff access, define retention/deletion, and do not use private notes as public listing text.
- Do not promise that food is safe, available, suitable for a particular diet, or free from cross-contact. State that donors and recipients must inspect original packaging and labels and arrange pickup at their own discretion.

## Legal and operational questions that block a public launch

These points are unresolved by this research and need advice from Texas counsel and the relevant local authority before public operation:

1. Whether a website that allows individuals to offer packaged groceries for free pickup is a regulated food establishment, food distribution operation, or other regulated activity under the Texas Food Establishment Rules and Brazos County requirements; whether registration, permitting, inspection, or a specific handling plan applies.
2. Which party is treated as a food donor, distributor, or operator, and what duties or liability apply to the platform, donors, moderators, and pickup-site hosts. Texas and federal statutes address charitable food donation, but this document does not determine whether their definitions, conditions, or liability protections cover this platform or any exchange.
3. Whether adults-only access, the proposed data handling, private messaging, location disclosure, moderation, and retention practices meet applicable privacy, consumer-protection, accessibility, and youth-safety requirements.
4. Written approval from each pickup-site operator, a complaint and recall response process, moderation staffing, insurance, and a named operator responsible for removal and incident handling.

Do not present the development prototype as an approved or legally compliant food-sharing service. Do not enable public food exchanges until those questions have been resolved and controls have an accountable operator.

## Official sources checked

- Texas DSHS, [Retail Food Establishments](https://www.dshs.texas.gov/retail-food-establishments) — describes the state retail-food program and establishment categories; links to permits, statutes, and industry resources. The page explains that retail food establishments include places where food is prepared for individual portion service for consumption on or off premises, whether or not food is charged for. This page alone does not classify this proposed peer exchange.
- Texas DSHS, [Permits for Retail Food Establishments](https://www.dshs.texas.gov/retail-food-establishments/permits-retail-food-establishments) and [Statutes and Laws](https://www.dshs.texas.gov/retail-food-establishments/statutes-laws-retail-food-establishments) — primary state program references; applicability to this project remains a legal question.
- Brazos County Health District, [Retail Food Service](https://health.brazoscountytx.gov/retail-food-service/) — describes annual health permits for food service establishments, stores, and bars; links to local food rules and the Texas Food Establishment Rules. The page links a 2021 TFER PDF and the 2017 FDA Food Code. Confirm current rules with the District before operation.
- FDA, [Food Allergies](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies) — identifies the nine major allergens and explains packaged-food ingredient/allergen labeling requirements and cross-contact concerns.
- FDA, [Food Code](https://www.fda.gov/food/retail-food-protection/fda-food-code) — FDA model code for retail and food-service regulation; local/state adoption determines the operative requirements. The checked page listed the 2026 edition as the newest model edition, while Brazos County's page linked older materials.
- The prototype uses a strict operational date rule: do not list any item past any printed date. This does not characterize the legal meaning of any particular date label.
- 42 U.S.C. § 1791, [Bill Emerson Good Samaritan Food Donation Act](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section1791&num=0&edition=prelim), and Texas Health & Safety Code Chapter 76, [Charitable Immunity and Liability of Food Donors](https://statutes.capitol.texas.gov/Docs/HS/htm/HS.76.htm) — statutory text to discuss with counsel; cited here without interpreting coverage or claiming immunity.

## Location-search note

The existing [OpenStreetMap setup notes](OPENSTREETMAP.md) say address search is disabled by default, submitted only on explicit form submission, and does not autocomplete. Preserve that restriction for food-sharing. Do not add public Nominatim autocomplete: a user's home or pickup address can reveal sensitive location information, and the public service policy is restrictive. If a future feature needs pickup-location selection, use approximate areas or an appropriately reviewed provider and disclose the data flow.

Reference: [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/), checked 2026-10-18.
