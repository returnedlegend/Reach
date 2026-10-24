# Student ownership guide

Reach is a student project supported by AI-generated implementation. Students should only claim work they actually did and can explain. A useful submission explains both the working demonstration and the real-data limitation. The target submission date supplied for this project is October 25, 2026; confirm competition rules and required disclosures independently.

## Understand the existing program

Start with `src/lib/types.ts`. Find the fields for a registration cutoff, the latest return, a service exception, and a source reference. Follow one fictional trip from the form into the planning engine and back to its explanation. Explain why catching the outbound bus alone does not establish that the visit works.

Read the timetable provider and explain its one-transfer limit. Compare a pantry window with the user's visit allowance. Explain why an unknown pedestrian pickup policy should produce confirmation rather than an invented prohibition. Demonstrate how the app keeps fictional data out of real coverage.

## Meaningful work to own

- **Verify one real journey:** resolve the existing BTD GTFS/PDF discrepancy, check service dates and exceptions, review a pantry walk, and manually trace departure, pantry arrival, and return. Record the evidence and who actually checked it.
- **Maintain pantry records:** field-check the eight website-reviewed listings, explicitly separating website statements from direct confirmations. Record unresolved questions honestly. Do not invent interviews or cite attempted web requests as confirmations.
- **Review walking connections:** inspect the actual paths with appropriate adult support. Record entrances, crossings, distance, time, and access limitations. Do not claim accessibility solely from a map.
- **Improve an engine rule:** write a failing test for a real edge case, implement a narrowly scoped fix, and explain why the test demonstrates the intended behavior. A first-four-Saturdays schedule is different from weekly Saturday service.
- **Improve access to the interface:** test keyboard operation, readable focus indicators, small phone layouts, zoom, and long labels. Record concrete observations and changes; only describe interviews or usability participants if they actually occurred.

Keep a dated record of each student's edits, reasoning, sources, and test commands. Review generated code before accepting it. It is better to explain a small implementation fully than to claim unsupported coverage.

## Questions students should be able to answer

1. What makes a plan fit, need confirmation, or fail?
2. Why are registration and distribution cutoffs separate?
3. How do monthly recurrence and holiday exceptions change results?
4. How is the return trip checked, and what happens after missing a bus?
5. Which records are website-reviewed, which are fictional, and what evidence is needed for a travel-ready real trip?
6. What data stays in the browser, and why is a saved plan not a reservation?
7. Which parts did students build, which did AI generate, and what did students verify?

The [AI assistance log](AI-ASSISTANCE.md) provides the starting disclosure. Add actual student contributions as they occur rather than assigning generated work to students retroactively.
