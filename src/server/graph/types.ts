export type MicrosoftGraphDateTime = {
  dateTime: string;
  timeZone?: string;
};

export type MicrosoftGraphEmailAddress = {
  address?: string;
  name?: string;
};

export type MicrosoftGraphEvent = {
  attendees?: Array<{
    emailAddress?: MicrosoftGraphEmailAddress;
  }>;
  bodyPreview?: string;
  end: MicrosoftGraphDateTime;
  id: string;
  isAllDay?: boolean;
  lastModifiedDateTime?: string;
  location?: {
    displayName?: string;
  };
  organizer?: {
    emailAddress?: MicrosoftGraphEmailAddress;
  };
  sensitivity?: "normal" | "personal" | "private" | "confidential" | string;
  showAs?: string;
  start: MicrosoftGraphDateTime;
  subject?: string;
  webLink?: string;
};

export type GraphCalendarRange = {
  endDateTime: string;
  startDateTime: string;
};
