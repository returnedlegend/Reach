import type {
  PublishedTimetable,
  Segment,
  TransitJourney,
  TransitProvider,
} from "./types";
import { parseTime, shiftDate, weekday } from "./time";

export class PublishedTimetableProvider implements TransitProvider {
  constructor(private timetable: PublishedTimetable) {}
  isValid(date: string): boolean {
    return date >= this.timetable.validFrom && date <= this.timetable.validTo;
  }
  journeys(
    date: string,
    fromStop: string,
    toStop: string,
    earliest: number,
    latest: number,
  ): TransitJourney[] {
    if (!this.isValid(date) || earliest > latest) return [];
    if (fromStop === toStop)
      return [{ departure: earliest, arrival: earliest, segments: [] }];
    const legs: Segment[] = [];
    // Yesterday's 25:10 is today's 01:10. Both use yesterday's service calendar.
    for (const offset of [-1, 0]) {
      const serviceDate = shiftDate(date, offset);
      if (!this.isValid(serviceDate)) continue;
      for (const trip of this.timetable.trips) {
        const calendar = this.timetable.calendars.find(
          (c) => c.id === trip.serviceId,
        );
        if (!calendar) continue;
        const active =
          calendar.exceptions?.[serviceDate] ??
          (serviceDate >= calendar.startDate &&
            serviceDate <= calendar.endDate &&
            calendar.weekdays.includes(weekday(serviceDate)));
        if (!active) continue;
        for (let i = 0; i < trip.stops.length; i++)
          for (let j = i + 1; j < trip.stops.length; j++) {
            const start =
              parseTime(trip.stops[i].departure, true) + offset * 1440;
            const end = parseTime(trip.stops[j].arrival, true) + offset * 1440;
            if (start >= earliest && end <= latest && end >= start)
              legs.push({
                kind: "bus",
                from: trip.stops[i].stopId,
                to: trip.stops[j].stopId,
                start,
                end,
                route: trip.route,
                tripId: trip.id,
                sourceIds: trip.sourceIds,
              });
          }
      }
    }
    const results: TransitJourney[] = [];
    for (const first of legs.filter((l) => l.from === fromStop)) {
      if (first.to === toStop)
        results.push({
          departure: first.start,
          arrival: first.end,
          segments: [first],
        });
      else
        for (const second of legs.filter(
          (l) =>
            l.from === first.to &&
            l.to === toStop &&
            l.tripId !== first.tripId &&
            l.start >= first.end + this.timetable.minTransferMinutes,
        )) {
          results.push({
            departure: first.start,
            arrival: second.end,
            segments: [
              first,
              {
                kind: "wait",
                from: first.to,
                to: first.to,
                start: first.end,
                end: second.start,
              },
              second,
            ],
          });
        }
    }
    return results.sort(
      (a, b) => a.arrival - b.arrival || b.departure - a.departure,
    );
  }
}
