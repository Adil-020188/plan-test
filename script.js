(function () {
  "use strict";

  const STORAGE_KEY = "energyPlannerComparisonV1";
  const HOUR_COUNT = 24;
  const DISPLAY_VOLUME_DECIMALS = 6;

  const elements = {
    previousDate: document.querySelector("#previous-date"),
    currentDate: document.querySelector("#current-date"),
    dateError: document.querySelector("#date-error"),
    previousDateLabel: document.querySelector("#previous-date-label"),
    currentDateLabel: document.querySelector("#current-date-label"),
    previousTariffDate: document.querySelector("#previous-tariff-date"),
    currentTariffDate: document.querySelector("#current-tariff-date"),
    hourlyRows: document.querySelector("#hourly-rows"),
    previousTotal: document.querySelector("#previous-total"),
    currentTotal: document.querySelector("#current-total"),
    differenceTotal: document.querySelector("#difference-total"),
    percentTotal: document.querySelector("#percent-total"),
    tariffInputs: Array.from(document.querySelectorAll(".tariff-input"))
  };

  let state = readState();
  let pairIsValid = false;
  const rowControls = [];

  function emptyRecord() {
    return {
      volumes: Array(HOUR_COUNT).fill(null),
      tariffs: {
        withoutVat: null,
        withVat: null
      }
    };
  }

  function cleanRecord(record) {
    const clean = emptyRecord();

    if (!record || typeof record !== "object") {
      return clean;
    }

    if (Array.isArray(record.volumes)) {
      clean.volumes = clean.volumes.map(function (_, index) {
        const value = record.volumes[index];
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      });
    }

    if (record.tariffs && typeof record.tariffs === "object") {
      ["withoutVat", "withVat"].forEach(function (name) {
        const value = record.tariffs[name];
        clean.tariffs[name] = Number.isSafeInteger(value) && value >= 0 ? value : null;
      });
    }

    return clean;
  }

  function readState() {
    const initial = { selected: null, records: {} };

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") {
        return initial;
      }

      if (saved.selected && isDateString(saved.selected.previous) && isDateString(saved.selected.current)) {
        initial.selected = {
          previous: saved.selected.previous,
          current: saved.selected.current
        };
      }

      if (saved.records && typeof saved.records === "object") {
        Object.keys(saved.records).forEach(function (date) {
          if (isDateString(date)) {
            initial.records[date] = cleanRecord(saved.records[date]);
          }
        });
      }
    } catch (error) {
      return initial;
    }

    return initial;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // Страница остаётся рабочей, даже если хранилище браузера недоступно.
    }
  }

  function isDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      return false;
    }

    const date = parseLocalDate(value);
    return Boolean(date) && toDateInputValue(date) === value;
  }

  function parseLocalDate(value) {
    const parts = (value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return !Number.isInteger(part); })) {
      return null;
    }

    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (
      date.getFullYear() !== parts[0] ||
      date.getMonth() !== parts[1] - 1 ||
      date.getDate() !== parts[2]
    ) {
      return null;
    }

    return date;
  }

  function toDateInputValue(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function defaultDates() {
    const current = new Date();
    current.setHours(12, 0, 0, 0);

    const previousYear = current.getMonth() === 0 ? current.getFullYear() - 1 : current.getFullYear();
    const previousMonth = current.getMonth() === 0 ? 11 : current.getMonth() - 1;
    const lastPreviousDay = new Date(previousYear, previousMonth + 1, 0).getDate();
    const previous = new Date(previousYear, previousMonth, Math.min(current.getDate(), lastPreviousDay), 12);

    return {
      previous: toDateInputValue(previous),
      current: toDateInputValue(current)
    };
  }

  function areConsecutiveMonths(previousValue, currentValue) {
    const previous = parseLocalDate(previousValue);
    const current = parseLocalDate(currentValue);

    if (!previous || !current) {
      return false;
    }

    const previousIndex = previous.getFullYear() * 12 + previous.getMonth();
    const currentIndex = current.getFullYear() * 12 + current.getMonth();
    return currentIndex - previousIndex === 1;
  }

  function formatDate(value) {
    const date = parseLocalDate(value);
    if (!date) {
      return "—";
    }

    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatNumber(value, maximumFractionDigits) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "—";
    }

    const normalized = Object.is(value, -0) ? 0 : value;
    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: maximumFractionDigits,
      useGrouping: true
    }).format(normalized);
  }

  function formatMoney(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return "";
    }

    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
  }

  function parseVolume(value) {
    const normalized = String(value).trim().replace(",", ".");
    const expression = /^(?:\d+(?:[.]\d*)?|[.]\d+)$/;

    if (!expression.test(normalized)) {
      return null;
    }

    const number = Number(normalized);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function parseTariff(value) {
    const normalized = String(value)
      .replace(/₸/g, "")
      .replace(/[\s\u00a0\u202f]/g, "")
      .trim();

    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    const number = Number(normalized);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function getRecord(date) {
    if (!state.records[date]) {
      state.records[date] = emptyRecord();
    }
    return state.records[date];
  }

  function getDateForPeriod(period) {
    return period === "previous" ? elements.previousDate.value : elements.currentDate.value;
  }

  function createRows() {
    const fragment = document.createDocumentFragment();

    for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
      const row = document.createElement("tr");
      const nextHour = (hour + 1) % HOUR_COUNT;
      const time = String(hour).padStart(2, "0") + ":00–" + String(nextHour).padStart(2, "0") + ":00";

      const hourCell = document.createElement("th");
      hourCell.className = "hour-column";
      hourCell.scope = "row";
      hourCell.textContent = time;
      row.appendChild(hourCell);

      const previous = createVolumeCell("previous", hour, time);
      const current = createVolumeCell("current", hour, time);
      const difference = createCalculatedCell("Разница за " + time);
      const percent = createCalculatedCell("Разница в процентах за " + time);

      row.appendChild(previous.cell);
      row.appendChild(current.cell);
      row.appendChild(difference);
      row.appendChild(percent);
      fragment.appendChild(row);

      rowControls.push({
        previous: previous.input,
        current: current.input,
        difference: difference,
        percent: percent
      });
    }

    elements.hourlyRows.appendChild(fragment);
  }

  function createVolumeCell(period, hour, time) {
    const cell = document.createElement("td");
    const input = document.createElement("input");
    const periodLabel = period === "previous" ? "предыдущего" : "текущего";

    input.className = "volume-input";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = "0";
    input.dataset.period = period;
    input.dataset.hour = String(hour);
    input.setAttribute("aria-label", "Объём " + periodLabel + " месяца за " + time + ", кВт*ч");
    input.addEventListener("input", handleVolumeInput);
    input.addEventListener("blur", handleVolumeBlur);
    cell.appendChild(input);

    return { cell: cell, input: input };
  }

  function createCalculatedCell(label) {
    const cell = document.createElement("td");
    cell.className = "calculated-cell";
    cell.textContent = "—";
    cell.setAttribute("aria-label", label);
    return cell;
  }

  function setDifferenceStyle(element, value) {
    element.classList.toggle("positive-value", typeof value === "number" && value > 0);
    element.classList.toggle("negative-value", typeof value === "number" && value < 0);
  }

  function validatePair() {
    const previous = elements.previousDate.value;
    const current = elements.currentDate.value;
    let message = "";

    if (!isDateString(previous) || !isDateString(current)) {
      message = "Выберите обе даты для сравнения.";
    } else if (!areConsecutiveMonths(previous, current)) {
      message = "Слева выберите дату из месяца, который идёт прямо перед месяцем справа.";
    }

    pairIsValid = message === "";
    elements.dateError.hidden = pairIsValid;
    elements.dateError.textContent = message;
    elements.previousDate.setAttribute("aria-invalid", String(!pairIsValid));
    elements.currentDate.setAttribute("aria-invalid", String(!pairIsValid));
    setFormDisabled(!pairIsValid);

    return pairIsValid;
  }

  function setFormDisabled(disabled) {
    rowControls.forEach(function (row) {
      row.previous.disabled = disabled;
      row.current.disabled = disabled;
    });
    elements.tariffInputs.forEach(function (input) {
      input.disabled = disabled;
    });
  }

  function updateDateLabels() {
    const previousLabel = formatDate(elements.previousDate.value);
    const currentLabel = formatDate(elements.currentDate.value);
    elements.previousDateLabel.textContent = previousLabel;
    elements.currentDateLabel.textContent = currentLabel;
    elements.previousTariffDate.textContent = previousLabel;
    elements.currentTariffDate.textContent = currentLabel;
  }

  function loadVisibleData() {
    updateDateLabels();
    clearTariffErrors();

    if (!pairIsValid) {
      rowControls.forEach(function (row) {
        row.previous.value = "";
        row.current.value = "";
        row.difference.textContent = "—";
        row.percent.textContent = "—";
        setDifferenceStyle(row.difference, null);
        setDifferenceStyle(row.percent, null);
      });
      elements.tariffInputs.forEach(function (input) { input.value = ""; });
      renderTotals(0, 0);
      return;
    }

    const previousRecord = getRecord(elements.previousDate.value);
    const currentRecord = getRecord(elements.currentDate.value);

    rowControls.forEach(function (row, hour) {
      const previousValue = previousRecord.volumes[hour];
      const currentValue = currentRecord.volumes[hour];
      row.previous.value = previousValue === null ? "" : String(previousValue).replace(".", ",");
      row.current.value = currentValue === null ? "" : String(currentValue).replace(".", ",");
      row.previous.removeAttribute("aria-invalid");
      row.current.removeAttribute("aria-invalid");
    });

    elements.tariffInputs.forEach(function (input) {
      const record = getRecord(getDateForPeriod(input.dataset.period));
      input.value = formatMoney(record.tariffs[input.dataset.tariff]);
      input.removeAttribute("aria-invalid");
    });

    calculateAll();
  }

  function handleDateChange() {
    if (validatePair()) {
      state.selected = {
        previous: elements.previousDate.value,
        current: elements.currentDate.value
      };
      getRecord(state.selected.previous);
      getRecord(state.selected.current);
      saveState();
    }

    loadVisibleData();
  }

  function handleVolumeInput(event) {
    const input = event.currentTarget;
    const parsed = input.value.trim() === "" ? null : parseVolume(input.value);
    const isInvalid = input.value.trim() !== "" && parsed === null;

    input.setAttribute("aria-invalid", String(isInvalid));

    if (pairIsValid) {
      const record = getRecord(getDateForPeriod(input.dataset.period));
      record.volumes[Number(input.dataset.hour)] = parsed;
      saveState();
      calculateAll();
    }
  }

  function handleVolumeBlur(event) {
    const input = event.currentTarget;
    const parsed = parseVolume(input.value);
    if (parsed !== null) {
      input.value = String(parsed).replace(".", ",");
      input.removeAttribute("aria-invalid");
    }
  }

  function calculateAll() {
    let previousTotal = 0;
    let currentTotal = 0;

    rowControls.forEach(function (row) {
      const previous = parseVolume(row.previous.value);
      const current = parseVolume(row.current.value);
      const previousForTotal = previous === null ? 0 : previous;
      const currentForTotal = current === null ? 0 : current;

      previousTotal += previousForTotal;
      currentTotal += currentForTotal;

      if (previous === null && current === null) {
        row.difference.textContent = "—";
        row.percent.textContent = "—";
        setDifferenceStyle(row.difference, null);
        setDifferenceStyle(row.percent, null);
        return;
      }

      const difference = currentForTotal - previousForTotal;
      row.difference.textContent = formatNumber(difference, DISPLAY_VOLUME_DECIMALS);
      row.percent.textContent = previous !== null && previous > 0
        ? formatNumber((difference / previous) * 100, 2) + "%"
        : "—";
      setDifferenceStyle(row.difference, difference);
      setDifferenceStyle(row.percent, previous !== null && previous > 0 ? difference : null);
    });

    renderTotals(previousTotal, currentTotal);
  }

  function renderTotals(previous, current) {
    const difference = current - previous;
    elements.previousTotal.textContent = formatNumber(previous, DISPLAY_VOLUME_DECIMALS);
    elements.currentTotal.textContent = formatNumber(current, DISPLAY_VOLUME_DECIMALS);
    elements.differenceTotal.textContent = formatNumber(difference, DISPLAY_VOLUME_DECIMALS);
    elements.percentTotal.textContent = previous > 0
      ? formatNumber((difference / previous) * 100, 2) + "%"
      : "—";
    setDifferenceStyle(elements.differenceTotal, difference);
    setDifferenceStyle(elements.percentTotal, previous > 0 ? difference : null);
  }

  function clearTariffErrors() {
    elements.tariffInputs.forEach(function (input) {
      const error = document.querySelector("#" + input.id + "-error");
      error.textContent = "";
    });
  }

  function handleTariffFocus(event) {
    const input = event.currentTarget;
    const parsed = parseTariff(input.value);
    if (parsed !== null) {
      input.value = String(parsed);
    }
  }

  function handleTariffInput(event) {
    const input = event.currentTarget;
    const error = document.querySelector("#" + input.id + "-error");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  }

  function handleTariffBlur(event) {
    const input = event.currentTarget;
    const value = parseTariff(input.value);
    const error = document.querySelector("#" + input.id + "-error");
    const record = getRecord(getDateForPeriod(input.dataset.period));

    if (value === null) {
      record.tariffs[input.dataset.tariff] = null;
      input.value = "";
      input.setAttribute("aria-invalid", "true");
      error.textContent = "Введите целое число";
      saveState();
      return;
    }

    record.tariffs[input.dataset.tariff] = value;
    input.value = formatMoney(value);
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    saveState();
  }

  function initialize() {
    createRows();

    const dates = state.selected && areConsecutiveMonths(state.selected.previous, state.selected.current)
      ? state.selected
      : defaultDates();
    elements.previousDate.value = dates.previous;
    elements.currentDate.value = dates.current;

    elements.previousDate.addEventListener("change", handleDateChange);
    elements.currentDate.addEventListener("change", handleDateChange);
    elements.tariffInputs.forEach(function (input) {
      input.addEventListener("focus", handleTariffFocus);
      input.addEventListener("input", handleTariffInput);
      input.addEventListener("blur", handleTariffBlur);
    });

    validatePair();
    if (pairIsValid) {
      state.selected = { previous: dates.previous, current: dates.current };
      getRecord(dates.previous);
      getRecord(dates.current);
      saveState();
    }
    loadVisibleData();
  }

  initialize();
})();
