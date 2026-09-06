export interface DateRange {
  startTime?: string;
  endTime?: string;
}

function formatDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateRange(message: string, today = new Date()): DateRange {
  if (message.includes('上月')) {
    return {
      startTime: formatDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      endTime: formatDate(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }

  if (message.includes('本月')) {
    return {
      startTime: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      endTime: formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }

  const explicit = message.match(/(\d{4})[-年](\d{1,2})/);
  if (explicit) {
    const year = Number(explicit[1]);
    const month = Number(explicit[2]) - 1;
    return {
      startTime: formatDate(new Date(year, month, 1)),
      endTime: formatDate(new Date(year, month + 1, 0)),
    };
  }

  return {};
}
