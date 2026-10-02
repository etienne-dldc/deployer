import { Datatype } from "@dldc/zendb";

export function zonedDateTimeDt() {
  return Datatype.create<Temporal.ZonedDateTime, string>({
    name: "zonedDateTime",
    serialize: (value) => value.toString(),
    parse: (value) => Temporal.ZonedDateTime.from(value),
    type: "TEXT",
  });
}

export function plainDateDt() {
  return Datatype.create<Temporal.PlainDate, string>({
    name: "plainDate",
    serialize: (value) => value.toString(),
    parse: (value) => Temporal.PlainDate.from(value),
    type: "TEXT",
  });
}

export function plainTimeDt() {
  return Datatype.create<Temporal.PlainTime, string>({
    name: "plainTime",
    serialize: (value) => value.toString(),
    parse: (value) => Temporal.PlainTime.from(value),
    type: "TEXT",
  });
}

export function instantDt() {
  return Datatype.create<Temporal.Instant, string>({
    name: "instant",
    serialize: (value) => value.toString(),
    parse: (value) => Temporal.Instant.from(value),
    type: "TEXT",
  });
}
