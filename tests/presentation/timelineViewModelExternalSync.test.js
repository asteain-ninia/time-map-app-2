import { describe, expect, it, vi } from 'vitest';
import { TimelineViewModel } from '../../src/presentation/view-models/TimelineViewModel.js';
import { EventBus } from '../../src/presentation/EventBus.js';
import { TimePoint } from '../../src/domain/value-objects/TimePoint.js';

function createNavigateTimeUseCaseMock(initialTime = new TimePoint(1000)) {
  let currentTime = initialTime;
  return {
    getCurrentTime: () => currentTime,
    moveToTime: (year, month, day) => {
      const normalizedMonth = month === undefined ? null : month;
      const normalizedDay = day === undefined ? null : day;
      currentTime = new TimePoint(year, normalizedMonth, normalizedDay);
      return currentTime;
    },
    advanceTime: (days) => {
      currentTime = new TimePoint(currentTime.year + days, currentTime.month, currentTime.day);
      return currentTime;
    },
    advanceMonths: (months) => {
      currentTime = new TimePoint(currentTime.year, (currentTime.month ?? 1) + months, currentTime.day);
      return currentTime;
    },
    getCalendarConfig: () => ({ monthsPerYear: 12, daysPerYear: 365 }),
    getDaysInMonth: () => 31
  };
}

describe('TimelineViewModel external time sync', () => {
  it('updates currentTime from external TimeChanged events', () => {
    const eventBus = new EventBus();
    const navigateTimeUseCase = createNavigateTimeUseCaseMock(new TimePoint(1000));
    const viewModel = new TimelineViewModel(navigateTimeUseCase, eventBus);
    const observer = vi.fn();
    viewModel.addObserver(observer);

    const externalTime = new TimePoint(1300, null, null);
    eventBus.publish('TimeChanged', { time: externalTime });

    expect(viewModel.getCurrentTime()).toBe(externalTime);
    expect(observer).toHaveBeenCalledWith('currentTime', externalTime);
  });

  it('does not notify currentTime twice for internal moveToTime', () => {
    const eventBus = new EventBus();
    const navigateTimeUseCase = createNavigateTimeUseCaseMock(new TimePoint(1000));
    const viewModel = new TimelineViewModel(navigateTimeUseCase, eventBus);
    const observer = vi.fn();
    viewModel.addObserver(observer);

    viewModel.moveToTime(1100);

    const currentTimeNotifications = observer.mock.calls.filter(([type]) => type === 'currentTime');
    expect(currentTimeNotifications).toHaveLength(1);
    expect(viewModel.getCurrentTime().year).toBe(1100);
  });
});
