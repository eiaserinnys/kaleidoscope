import type { ConversationGroup, ConversationModel } from "../contract/contract";

export interface ExecutionPlace {
  id: string;
  label: string;
  models: ConversationModel[];
  available: boolean;
}

export const placeIdOf = (model: { group?: ConversationGroup }) => model.group?.id ?? "";

export function executionPlaces(models: ConversationModel[]): ExecutionPlace[] {
  const places: ExecutionPlace[] = [];
  for (const model of models) {
    const id = placeIdOf(model);
    let place = places.find((item) => item.id === id);
    if (!place) {
      place = { id, label: model.group?.label ?? "기타", models: [], available: false };
      places.push(place);
    }
    place.models.push(model);
    place.available ||= model.available;
  }
  return places;
}

export function pickModel(place: ExecutionPlace, label?: string): ConversationModel | undefined {
  return place.models.find((model) => model.available && model.label === label)
    ?? place.models.find((model) => model.available);
}

export function keepStartModel(models: ConversationModel[], startModel: string | null, previous: ConversationModel | undefined): string | null {
  if (!previous) return startModel;
  const place = executionPlaces(models).find((item) => item.id === placeIdOf(previous));
  return place ? pickModel(place, previous.label)?.id ?? startModel : startModel;
}
