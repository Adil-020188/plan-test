(function () {
  "use strict";

  const STORAGE_KEY = "energyPlannerComparisonV1";
  const HOUR_COUNT = 24;
  const DISPLAY_VOLUME_DECIMALS = 6;
  const MAX_HOURLY_VOLUME = Number.MAX_VALUE / (HOUR_COUNT * 2);
  const MAX_XLSX_SIZE = 5 * 1024 * 1024;
  const MAX_IMPORT_ROWS = 62 * HOUR_COUNT;
  const DEFAULT_VAT = 16;
  const MAX_RATE_VALUE = Number.MAX_SAFE_INTEGER;
  const MAX_RATE_INPUT_LENGTH = 30;

  const elements = {
    viewButtons: Array.from(document.querySelectorAll("[data-view-target]")),
    views: Array.from(document.querySelectorAll("[data-view]")),
    mainMonth: document.querySelector("#main-month"),
    analyticsMonth: document.querySelector("#analytics-month"),
    homeCurrentTotal: document.querySelector("#home-current-total"),
    homePreviousTotal: document.querySelector("#home-previous-total"),
    homeDifferenceTotal: document.querySelector("#home-difference-total"),
    homePercentTotal: document.querySelector("#home-percent-total"),
    homeWithoutVat: document.querySelector("#home-without-vat"),
    homeWithVat: document.querySelector("#home-with-vat"),
    homeCompleteDays: document.querySelector("#home-complete-days"),
    homeThresholdDays: document.querySelector("#home-threshold-days"),
    homeVolumeChart: document.querySelector("#home-volume-chart"),
    homeChartDescription: document.querySelector("#home-chart-description"),
    monthDayList: document.querySelector("#month-day-list"),
    monthPreviousTotal: document.querySelector("#month-previous-total"),
    monthCurrentTotal: document.querySelector("#month-current-total"),
    monthDifferenceTotal: document.querySelector("#month-difference-total"),
    monthPercentTotal: document.querySelector("#month-percent-total"),
    monthCompleteDays: document.querySelector("#month-complete-days"),
    previousTariffDate: document.querySelector("#previous-tariff-date"),
    currentTariffDate: document.querySelector("#current-tariff-date"),
    xlsxFile: document.querySelector("#xlsx-file"),
    checkXlsx: document.querySelector("#check-xlsx"),
    loadXlsx: document.querySelector("#load-xlsx"),
    importResult: document.querySelector("#import-result"),
    importStatus: document.querySelector("#import-status"),
    importFileName: document.querySelector("#import-file-name"),
    importMonth: document.querySelector("#import-month"),
    importRowCount: document.querySelector("#import-row-count"),
    importDateCount: document.querySelector("#import-date-count"),
    importTotal: document.querySelector("#import-total"),
    importReplacementCount: document.querySelector("#import-replacement-count"),
    importErrors: document.querySelector("#import-errors"),
    importErrorList: document.querySelector("#import-error-list"),
    importActionHelp: document.querySelector("#import-action-help"),
    tariffInputs: Array.from(document.querySelectorAll(".tariff-input")),
    tariffResults: Array.from(document.querySelectorAll(".tariff-results"))
  };

  let state = readState();
  let pendingImport = null;

  function showView(viewName) {
    const safeView = viewName === "analytics" ? "analytics" : "main";

    if (safeView === "main" && isMonthString(elements.analyticsMonth.value)) {
      renderMonthSummary(elements.analyticsMonth.value);
    }

    elements.views.forEach(function (view) {
      view.hidden = view.dataset.view !== safeView;
    });

    elements.viewButtons.forEach(function (button) {
      const isActive = button.dataset.viewTarget === safeView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    state.view = safeView;
    saveState();
  }

  function isMonthString(value) {
    if (!/^\d{4}-\d{2}$/.test(value || "")) {
      return false;
    }

    const parts = value.split("-").map(Number);
    return parts[0] >= 1 && parts[1] >= 1 && parts[1] <= 12;
  }

  function previousMonthValue(value) {
    if (!isMonthString(value)) {
      return null;
    }

    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 2, 1, 12);
    return String(date.getFullYear()).padStart(4, "0") + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function daysInMonth(value) {
    if (!isMonthString(value)) {
      return 0;
    }

    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1], 0).getDate();
  }

  function dateForMonthDay(month, day) {
    return month + "-" + String(day).padStart(2, "0");
  }

  function summarizeDate(date) {
    const record = state.records[date];
    const volumes = record && Array.isArray(record.volumes) ? record.volumes : [];
    let total = 0;
    let filled = 0;

    for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
      const value = volumes[hour];
      if (isValidVolume(value)) {
        total += value;
        filled += 1;
      }
    }

    return { total: total, filled: filled, hasData: filled > 0 };
  }

  function summarizeMonth(currentMonth) {
    const previousMonth = previousMonthValue(currentMonth);
    const currentDayCount = daysInMonth(currentMonth);
    const previousDayCount = daysInMonth(previousMonth);
    let previousTotal = 0;
    let currentTotal = 0;
    let completeDays = 0;
    let thresholdDays = 0;

    for (let day = 1; day <= currentDayCount; day += 1) {
      const current = summarizeDate(dateForMonthDay(currentMonth, day));
      currentTotal += current.total;
      if (current.filled === HOUR_COUNT) {
        completeDays += 1;
      }

      if (day <= previousDayCount) {
        const previous = summarizeDate(dateForMonthDay(previousMonth, day));
        previousTotal += previous.total;
        if (current.hasData && previous.hasData && previous.total > 0) {
          const dayPercent = ((current.total - previous.total) / previous.total) * 100;
          if (Number.isFinite(dayPercent) && Math.abs(dayPercent) > 20) {
            thresholdDays += 1;
          }
        }
      }
    }

    return {
      previousTotal: previousTotal,
      currentTotal: currentTotal,
      completeDays: completeDays,
      thresholdDays: thresholdDays,
      dayCount: currentDayCount
    };
  }

  function formatSignedNumber(value, maximumFractionDigits) {
    const formatted = formatNumber(value, maximumFractionDigits);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? "+" + formatted : formatted;
  }

  function formatWholeMoney(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "—";
    }

    return formatNumber(Math.round(value), 0) + " ₸";
  }

  function createSvgElement(name, attributes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attributes || {}).forEach(function (attribute) {
      element.setAttribute(attribute, String(attributes[attribute]));
    });
    return element;
  }

  function appendChartText(parent, text, x, y, className) {
    const label = createSvgElement("text", { x: x, y: y, class: className });
    label.textContent = text;
    parent.appendChild(label);
  }

  function getChartFactDays(currentMonth) {
    if (!isMonthString(currentMonth)) {
      return [];
    }

    const previousMonth = previousMonthValue(currentMonth);
    const currentDayCount = daysInMonth(currentMonth);
    const previousDayCount = daysInMonth(previousMonth);
    const days = [];

    for (let day = 1; day <= currentDayCount; day += 1) {
      const current = summarizeDate(dateForMonthDay(currentMonth, day));
      const previous = day <= previousDayCount
        ? summarizeDate(dateForMonthDay(previousMonth, day))
        : { total: 0, filled: 0, hasData: false };
      days.push({
        day: day,
        current: current.hasData ? current.total : null,
        previous: previous.hasData ? previous.total : null
      });
    }

    return days;
  }

  function getChartMaximum(days) {
    let maximum = 0;

    days.forEach(function (item) {
      [item.previous, item.current].forEach(function (value) {
        if (typeof value === "number" && Number.isFinite(value) && value > maximum) {
          maximum = value;
        }
      });
    });

    return maximum + 2000;
  }

  function formatChartDate(month, day) {
    const monthNumber = month.slice(5, 7);
    return String(day).padStart(2, "0") + "." + monthNumber;
  }

  function appendChartSeries(parent, days, field, maximum, plot) {
    const seriesClass = field === "previous"
      ? "home-chart-series home-chart-series-previous"
      : "home-chart-series home-chart-series-current";
    const pointClass = field === "previous"
      ? "home-chart-point home-chart-point-previous"
      : "home-chart-point home-chart-point-current";
    let commands = [];

    function finishSegment() {
      if (commands.length > 1) {
        parent.appendChild(createSvgElement("path", {
          d: commands.join(" "),
          class: seriesClass
        }));
      }
      commands = [];
    }

    days.forEach(function (item, index) {
      const value = item[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        finishSegment();
        return;
      }

      const x = plot.left + plot.daySpacing * (index + 0.5);
      const y = plot.bottom - value / maximum * (plot.bottom - plot.top);
      commands.push((commands.length === 0 ? "M " : "L ") + x + " " + y);
      parent.appendChild(createSvgElement("circle", {
        cx: x,
        cy: y,
        r: 3.5,
        class: pointClass
      }));
    });

    finishSegment();
  }

  function renderHomeChartFrame(currentMonth) {
    const chart = elements.homeVolumeChart;
    const chartWidth = 1400;
    const plotLeft = 130;
    const plotRight = 1365;
    const plotTop = 55;
    const plotBottom = 345;
    const tickCount = 4;
    const days = getChartFactDays(currentMonth);
    chart.replaceChildren(elements.homeChartDescription);

    if (days.length === 0) {
      elements.homeChartDescription.textContent = "Выберите месяц, чтобы увидеть шкалу суточных объёмов.";
      appendChartText(chart, "Выберите месяц", chartWidth / 2, 215, "home-chart-date-label");
      return;
    }

    const maximum = getChartMaximum(days);
    const plotWidth = plotRight - plotLeft;
    const daySpacing = plotWidth / days.length;
    const plot = {
      left: plotLeft,
      top: plotTop,
      bottom: plotBottom,
      daySpacing: daySpacing
    };
    const fragment = document.createDocumentFragment();

    appendChartText(fragment, "Объём, кВт*ч", 20, 28, "home-chart-unit-label");

    for (let tick = 0; tick <= tickCount; tick += 1) {
      const ratio = tick / tickCount;
      const y = plotBottom - ratio * (plotBottom - plotTop);
      const value = maximum * ratio;
      fragment.appendChild(createSvgElement("line", {
        x1: plotLeft,
        y1: y,
        x2: plotRight,
        y2: y,
        class: "home-chart-grid-line"
      }));
      appendChartText(fragment, formatNumber(value, 2), plotLeft - 14, y + 4, "home-chart-axis-label");
    }

    fragment.appendChild(createSvgElement("line", {
      x1: plotLeft,
      y1: plotTop,
      x2: plotLeft,
      y2: plotBottom,
      class: "home-chart-axis-line"
    }));
    fragment.appendChild(createSvgElement("line", {
      x1: plotLeft,
      y1: plotBottom,
      x2: plotRight,
      y2: plotBottom,
      class: "home-chart-axis-line"
    }));

    appendChartSeries(fragment, days, "previous", maximum, plot);
    appendChartSeries(fragment, days, "current", maximum, plot);

    days.forEach(function (item, index) {
      const x = plotLeft + daySpacing * (index + 0.5);
      appendChartText(fragment, formatChartDate(currentMonth, item.day), x, 382, "home-chart-date-label");
    });

    chart.appendChild(fragment);
    const previousCount = days.filter(function (item) { return item.previous !== null; }).length;
    const currentCount = days.filter(function (item) { return item.current !== null; }).length;
    elements.homeChartDescription.textContent = "График суточных объёмов за "
      + monthLabel(currentMonth)
      + ": от 0 до "
      + formatNumber(maximum, 2)
      + " кВт*ч. Дней с фактом предыдущего месяца: "
      + previousCount
      + ", текущего месяца: "
      + currentCount
      + ".";
  }

  function renderHomeSummary(currentMonth, summary) {
    if (!summary || !isMonthString(currentMonth)) {
      elements.homePreviousTotal.textContent = "—";
      elements.homeCurrentTotal.textContent = "—";
      elements.homeDifferenceTotal.textContent = "—";
      elements.homePercentTotal.textContent = "—";
      elements.homeWithoutVat.textContent = "—";
      elements.homeWithVat.textContent = "—";
      elements.homeCompleteDays.textContent = "—";
      elements.homeThresholdDays.textContent = "—";
      setDifferenceStyle(elements.homeDifferenceTotal, null);
      setDifferenceStyle(elements.homePercentTotal, null);
      renderHomeChartFrame(currentMonth);
      return;
    }

    const difference = summary.currentTotal - summary.previousTotal;
    const percent = summary.previousTotal > 0 ? (difference / summary.previousTotal) * 100 : null;
    const amounts = calculateTariffAmounts(summary.currentTotal, getMonthlyTariff(currentMonth));

    elements.homePreviousTotal.textContent = formatNumber(summary.previousTotal, DISPLAY_VOLUME_DECIMALS);
    elements.homeCurrentTotal.textContent = formatNumber(summary.currentTotal, DISPLAY_VOLUME_DECIMALS);
    elements.homeDifferenceTotal.textContent = formatSignedNumber(difference, DISPLAY_VOLUME_DECIMALS);
    elements.homePercentTotal.textContent = percent === null ? "—" : formatSignedNumber(percent, 2) + "%";
    elements.homeWithoutVat.textContent = amounts ? formatWholeMoney(amounts.withoutVat) : "—";
    elements.homeWithVat.textContent = amounts ? formatWholeMoney(amounts.withVat) : "—";
    elements.homeCompleteDays.textContent = summary.completeDays + " из " + summary.dayCount;
    elements.homeThresholdDays.textContent = formatNumber(summary.thresholdDays, 0);
    setDifferenceStyle(elements.homeDifferenceTotal, difference);
    setDifferenceStyle(elements.homePercentTotal, percent);
    renderHomeChartFrame(currentMonth);
  }

  function renderMonthSummary(currentMonth) {
    if (!isMonthString(currentMonth)) {
      elements.monthPreviousTotal.textContent = "—";
      elements.monthCurrentTotal.textContent = "—";
      elements.monthDifferenceTotal.textContent = "—";
      elements.monthPercentTotal.textContent = "—";
      elements.monthCompleteDays.textContent = "—";
      setDifferenceStyle(elements.monthDifferenceTotal, null);
      setDifferenceStyle(elements.monthPercentTotal, null);
      renderTariffResults(currentMonth, null);
      renderHomeSummary(currentMonth, null);
      return;
    }

    const summary = summarizeMonth(currentMonth);
    const difference = summary.currentTotal - summary.previousTotal;
    const percent = summary.previousTotal > 0 ? (difference / summary.previousTotal) * 100 : null;
    elements.monthPreviousTotal.textContent = formatNumber(summary.previousTotal, DISPLAY_VOLUME_DECIMALS);
    elements.monthCurrentTotal.textContent = formatNumber(summary.currentTotal, DISPLAY_VOLUME_DECIMALS);
    elements.monthDifferenceTotal.textContent = formatNumber(difference, DISPLAY_VOLUME_DECIMALS);
    elements.monthPercentTotal.textContent = percent === null ? "—" : formatNumber(percent, 2) + "%";
    elements.monthCompleteDays.textContent = summary.completeDays + " из " + summary.dayCount;
    setDifferenceStyle(elements.monthDifferenceTotal, difference);
    setDifferenceStyle(elements.monthPercentTotal, percent);
    renderTariffResults(currentMonth, summary);
    renderHomeSummary(currentMonth, summary);
  }

  function calculateTariffAmounts(volume, tariff) {
    if (!Number.isFinite(volume) || volume < 0 || !isValidRate(tariff.withoutVat) || !isValidRate(tariff.vat)) {
      return null;
    }

    const withoutVat = volume * tariff.withoutVat;
    const vat = withoutVat * tariff.vat / 100;
    const withVat = withoutVat + vat;

    if (![withoutVat, vat, withVat].every(Number.isFinite)) {
      return null;
    }

    return {
      withoutVat: withoutVat,
      vat: vat,
      withVat: withVat
    };
  }

  function renderTariffResults(currentMonth, summary) {
    elements.tariffResults.forEach(function (results) {
      const period = results.dataset.period;
      const volumeElement = results.querySelector('[data-tariff-result="volume"]');
      const withoutVatElement = results.querySelector('[data-tariff-result="without-vat"]');
      const vatElement = results.querySelector('[data-tariff-result="vat"]');
      const withVatElement = results.querySelector('[data-tariff-result="with-vat"]');

      if (!summary || !isMonthString(currentMonth)) {
        volumeElement.textContent = "—";
        withoutVatElement.textContent = "—";
        vatElement.textContent = "—";
        withVatElement.textContent = "—";
        return;
      }

      const volume = period === "previous" ? summary.previousTotal : summary.currentTotal;
      const tariff = getMonthlyTariff(period === "previous" ? previousMonthValue(currentMonth) : currentMonth);
      const amounts = calculateTariffAmounts(volume, tariff);
      volumeElement.textContent = formatNumber(volume, DISPLAY_VOLUME_DECIMALS);
      withoutVatElement.textContent = amounts ? formatMoneyAmount(amounts.withoutVat) : "—";
      vatElement.textContent = amounts ? formatMoneyAmount(amounts.vat) : "—";
      withVatElement.textContent = amounts ? formatMoneyAmount(amounts.withVat) : "—";
    });
  }

  function createDayMetric(label, field) {
    const wrapper = document.createElement("span");
    const labelElement = document.createElement("span");
    const valueElement = document.createElement("strong");

    wrapper.className = "day-summary-metric";
    labelElement.className = "day-summary-metric-label";
    valueElement.className = "day-summary-metric-value";
    valueElement.dataset.summaryField = field;
    labelElement.textContent = label;
    wrapper.appendChild(labelElement);
    wrapper.appendChild(valueElement);
    return wrapper;
  }

  function setDayMetric(card, field, value, difference) {
    const element = card.querySelector('[data-summary-field="' + field + '"]');
    element.textContent = value;
    setDifferenceStyle(element, difference);
  }

  function updateDaySummary(card) {
    const currentDate = card.dataset.currentDate;
    const previousDate = card.dataset.previousDate || null;
    const current = summarizeDate(currentDate);
    const previous = previousDate ? summarizeDate(previousDate) : { total: 0, filled: 0, hasData: false };
    const hasDifference = current.hasData || previous.hasData;
    const difference = hasDifference ? current.total - previous.total : null;
    const percent = hasDifference && previous.hasData && previous.total > 0
      ? (difference / previous.total) * 100
      : null;

    setDayMetric(card, "previous-total", previous.hasData ? formatNumber(previous.total, DISPLAY_VOLUME_DECIMALS) : "—", null);
    setDayMetric(card, "current-total", current.hasData ? formatNumber(current.total, DISPLAY_VOLUME_DECIMALS) : "—", null);
    setDayMetric(card, "difference", difference === null ? "—" : formatNumber(difference, DISPLAY_VOLUME_DECIMALS), difference);
    setDayMetric(card, "percent", percent === null ? "—" : formatNumber(percent, 2) + "%", percent);
    setDayMetric(card, "filled", current.filled + " из " + HOUR_COUNT, null);
  }

  function getStoredVolume(date, hour) {
    if (!date || !state.records[date] || !Array.isArray(state.records[date].volumes)) {
      return null;
    }

    const value = state.records[date].volumes[hour];
    return isValidVolume(value) ? value : null;
  }

  function createMonthVolumeCell(recordDate, currentDate, previousDate, hour, time, period) {
    const cell = document.createElement("td");

    if (!recordDate) {
      cell.className = "unavailable-volume";
      cell.textContent = "—";
      return cell;
    }

    const input = document.createElement("input");
    const stored = getStoredVolume(recordDate, hour);
    const periodLabel = period === "previous" ? "предыдущего" : "текущего";
    input.className = "volume-input";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = "0";
    input.value = stored === null ? "" : String(stored).replace(".", ",");
    input.dataset.recordDate = recordDate;
    input.dataset.currentDate = currentDate;
    input.dataset.previousDate = previousDate || "";
    input.dataset.hour = String(hour);
    input.setAttribute("aria-label", "Объём " + periodLabel + " месяца за " + time + ", кВт*ч");
    input.addEventListener("input", handleMonthVolumeInput);
    input.addEventListener("blur", handleMonthVolumeBlur);
    cell.appendChild(input);
    return cell;
  }

  function createHourlyEditor(currentDate, previousDate) {
    const editor = document.createElement("div");
    const scroll = document.createElement("div");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const body = document.createElement("tbody");
    const headings = [
      { title: "Час", date: null, className: "hour-column" },
      { title: "Предыдущий", date: previousDate },
      { title: "Текущий", date: currentDate },
      { title: "Разница", date: null },
      { title: "Разница, %", date: null }
    ];

    scroll.className = "table-scroll day-table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("aria-label", "Почасовые объёмы за " + formatDate(currentDate));

    headings.forEach(function (heading) {
      const cell = document.createElement("th");
      cell.scope = "col";
      if (heading.className) {
        cell.className = heading.className;
      }
      const title = document.createElement("span");
      title.textContent = heading.title;
      cell.appendChild(title);
      if (heading.title === "Предыдущий" || heading.title === "Текущий") {
        const small = document.createElement("small");
        small.textContent = heading.date ? formatDate(heading.date) : "—";
        cell.appendChild(small);
      }
      headRow.appendChild(cell);
    });

    for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
      const row = document.createElement("tr");
      const nextHour = (hour + 1) % HOUR_COUNT;
      const time = String(hour).padStart(2, "0") + ":00–" + String(nextHour).padStart(2, "0") + ":00";
      const hourCell = document.createElement("th");
      const differenceCell = document.createElement("td");
      const percentCell = document.createElement("td");

      row.dataset.hour = String(hour);
      hourCell.className = "hour-column";
      hourCell.scope = "row";
      hourCell.textContent = time;
      differenceCell.className = "calculated-cell";
      differenceCell.dataset.hourlyField = "difference";
      percentCell.className = "calculated-cell";
      percentCell.dataset.hourlyField = "percent";

      row.appendChild(hourCell);
      row.appendChild(createMonthVolumeCell(previousDate, currentDate, previousDate, hour, time, "previous"));
      row.appendChild(createMonthVolumeCell(currentDate, currentDate, previousDate, hour, time, "current"));
      row.appendChild(differenceCell);
      row.appendChild(percentCell);
      body.appendChild(row);
      updateHourlyRow(row, currentDate, previousDate, hour);
    }

    head.appendChild(headRow);
    table.appendChild(head);
    table.appendChild(body);
    scroll.appendChild(table);
    const hint = document.createElement("p");
    hint.className = "scroll-hint";
    hint.textContent = "Проведите по таблице влево, чтобы увидеть все столбцы.";
    editor.appendChild(scroll);
    editor.appendChild(hint);
    return editor;
  }

  function updateHourlyRow(row, currentDate, previousDate, hour) {
    const previous = getStoredVolume(previousDate, hour);
    const current = getStoredVolume(currentDate, hour);
    const differenceCell = row.querySelector('[data-hourly-field="difference"]');
    const percentCell = row.querySelector('[data-hourly-field="percent"]');

    if (previous === null && current === null) {
      differenceCell.textContent = "—";
      percentCell.textContent = "—";
      setDifferenceStyle(differenceCell, null);
      setDifferenceStyle(percentCell, null);
      return;
    }

    const difference = (current === null ? 0 : current) - (previous === null ? 0 : previous);
    const percent = previous !== null && previous > 0 ? (difference / previous) * 100 : null;
    differenceCell.textContent = formatNumber(difference, DISPLAY_VOLUME_DECIMALS);
    percentCell.textContent = percent === null ? "—" : formatNumber(percent, 2) + "%";
    setDifferenceStyle(differenceCell, difference);
    setDifferenceStyle(percentCell, percent === null ? null : percent);
  }

  function handleMonthVolumeInput(event) {
    const input = event.currentTarget;
    const trimmed = input.value.trim();
    const parsed = trimmed === "" ? null : parseVolume(trimmed);
    const isInvalid = trimmed !== "" && parsed === null;
    input.setAttribute("aria-invalid", String(isInvalid));

    if (isInvalid) {
      return;
    }

    const hour = Number(input.dataset.hour);
    const record = getRecord(input.dataset.recordDate);
    record.volumes[hour] = parsed;
    saveState();

    const card = input.closest(".day-card");
    updateDaySummary(card);
    updateHourlyRow(input.closest("tr"), input.dataset.currentDate, input.dataset.previousDate || null, hour);
    renderMonthSummary(elements.analyticsMonth.value);
  }

  function handleMonthVolumeBlur(event) {
    const input = event.currentTarget;
    const trimmed = input.value.trim();
    const parsed = trimmed === "" ? null : parseVolume(trimmed);

    if (parsed !== null) {
      input.value = String(parsed).replace(".", ",");
    } else if (trimmed !== "") {
      const stored = getStoredVolume(input.dataset.recordDate, Number(input.dataset.hour));
      input.value = stored === null ? "" : String(stored).replace(".", ",");
    }
    input.removeAttribute("aria-invalid");
  }

  function createDayCard(currentDate, previousDate) {
    const card = document.createElement("article");
    const toggle = document.createElement("button");
    const icon = document.createElement("span");
    const title = document.createElement("span");
    const dateLabel = document.createElement("span");
    const comparisonLabel = document.createElement("span");
    const values = document.createElement("span");
    const details = document.createElement("div");
    const detailsId = "day-details-" + currentDate;

    card.className = "day-card";
    card.dataset.currentDate = currentDate;
    card.dataset.previousDate = previousDate || "";
    toggle.className = "day-summary";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", detailsId);
    icon.className = "day-summary-toggle-icon";
    icon.textContent = "›";
    icon.setAttribute("aria-hidden", "true");
    title.className = "day-summary-title";
    dateLabel.className = "day-summary-date";
    dateLabel.textContent = formatDate(currentDate);
    comparisonLabel.className = "day-summary-comparison";
    comparisonLabel.textContent = "Сравнение: " + (previousDate ? formatDate(previousDate) : "—");
    values.className = "day-summary-values";
    values.appendChild(createDayMetric("Предыдущий", "previous-total"));
    values.appendChild(createDayMetric("Текущий", "current-total"));
    values.appendChild(createDayMetric("Разница", "difference"));
    values.appendChild(createDayMetric("Изменение", "percent"));
    values.appendChild(createDayMetric("Заполнено", "filled"));
    details.className = "day-details";
    details.id = detailsId;
    details.hidden = true;

    title.appendChild(dateLabel);
    title.appendChild(comparisonLabel);
    toggle.appendChild(icon);
    toggle.appendChild(title);
    toggle.appendChild(values);
    card.appendChild(toggle);
    card.appendChild(details);
    updateDaySummary(card);

    toggle.addEventListener("click", function () {
      const willOpen = toggle.getAttribute("aria-expanded") !== "true";
      if (willOpen && !details.hasChildNodes()) {
        details.appendChild(createHourlyEditor(currentDate, previousDate));
      }
      toggle.setAttribute("aria-expanded", String(willOpen));
      details.hidden = !willOpen;
      card.classList.toggle("is-open", willOpen);
    });

    return card;
  }

  function renderMonthDays() {
    const currentMonth = elements.analyticsMonth.value;
    elements.monthDayList.replaceChildren();
    renderMonthSummary(currentMonth);
    updateTariffMonthLabels(currentMonth);

    if (!isMonthString(currentMonth)) {
      return;
    }

    const previousMonth = previousMonthValue(currentMonth);
    const currentDayCount = daysInMonth(currentMonth);
    const previousDayCount = daysInMonth(previousMonth);
    const fragment = document.createDocumentFragment();

    for (let day = 1; day <= currentDayCount; day += 1) {
      const currentDate = dateForMonthDay(currentMonth, day);
      const previousDate = day <= previousDayCount ? dateForMonthDay(previousMonth, day) : null;
      fragment.appendChild(createDayCard(currentDate, previousDate));
    }

    elements.monthDayList.appendChild(fragment);
  }

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
        return isValidVolume(value) ? value : null;
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

  function emptyMonthlyTariff() {
    return {
      withoutVat: null,
      vat: DEFAULT_VAT
    };
  }

  function cleanMonthlyTariff(tariff) {
    const clean = emptyMonthlyTariff();

    if (!tariff || typeof tariff !== "object") {
      return clean;
    }

    ["withoutVat", "vat"].forEach(function (name) {
      const value = tariff[name];
      if (isValidRate(value)) {
        clean[name] = value;
      }
    });

    return clean;
  }

  function migrateLegacyMonthlyTariffs(target) {
    const selectedDates = target.selected
      ? [target.selected.previous, target.selected.current]
      : [];
    const remainingDates = Object.keys(target.records)
      .filter(function (date) { return !selectedDates.includes(date); })
      .sort();

    selectedDates.concat(remainingDates).forEach(function (date) {
      const record = target.records[date];
      const month = date.slice(0, 7);
      const legacyTariff = record && record.tariffs ? record.tariffs.withoutVat : null;

      if (!Number.isSafeInteger(legacyTariff) || legacyTariff < 0) {
        return;
      }

      if (!target.monthlyTariffs[month]) {
        target.monthlyTariffs[month] = emptyMonthlyTariff();
      }

      if (target.monthlyTariffs[month].withoutVat === null) {
        target.monthlyTariffs[month].withoutVat = legacyTariff;
      }
    });
  }

  function readState() {
    const initial = {
      selected: null,
      records: {},
      monthlyTariffs: {},
      view: "main",
      analyticsMonth: null
    };

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

      if (saved.view === "main" || saved.view === "analytics") {
        initial.view = saved.view;
      }

      if (isMonthString(saved.analyticsMonth)) {
        initial.analyticsMonth = saved.analyticsMonth;
      }

      if (saved.records && typeof saved.records === "object") {
        Object.keys(saved.records).forEach(function (date) {
          if (isDateString(date)) {
            initial.records[date] = cleanRecord(saved.records[date]);
          }
        });
      }

      if (saved.monthlyTariffs && typeof saved.monthlyTariffs === "object") {
        Object.keys(saved.monthlyTariffs).forEach(function (month) {
          if (isMonthString(month)) {
            initial.monthlyTariffs[month] = cleanMonthlyTariff(saved.monthlyTariffs[month]);
          }
        });
      }

      migrateLegacyMonthlyTariffs(initial);
    } catch (error) {
      return initial;
    }

    return initial;
  }

  function saveState(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value || state));
      return true;
    } catch (error) {
      // Страница остаётся рабочей, даже если хранилище браузера недоступно.
      return false;
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

  function formatRate(value) {
    if (!isValidRate(value)) {
      return "";
    }

    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 20,
      useGrouping: true
    }).format(value);
  }

  function formatMoneyAmount(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "—";
    }

    const normalized = Object.is(value, -0) ? 0 : value;
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true
    }).format(normalized).replace(/[\u00a0\u202f]/g, " ") + " тенге";
  }

  function isValidVolume(value) {
    return typeof value === "number"
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_HOURLY_VOLUME;
  }

  function parseVolume(value) {
    const normalized = String(value).trim().replace(",", ".");
    const expression = /^(?:\d+(?:[.]\d*)?|[.]\d+)$/;

    if (!expression.test(normalized)) {
      return null;
    }

    const number = Number(normalized);
    return isValidVolume(number) ? number : null;
  }

  function isValidRate(value) {
    return typeof value === "number"
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_RATE_VALUE;
  }

  function parseRate(value) {
    const normalized = String(value)
      .replace(/₸/g, "")
      .replace(/[\s\u00a0\u202f]/g, "")
      .trim()
      .replace(",", ".");

    if (
      normalized.length === 0
      || normalized.length > MAX_RATE_INPUT_LENGTH
      || !/^(?:\d+(?:[.]\d*)?|[.]\d+)$/.test(normalized)
    ) {
      return null;
    }

    const number = Number(normalized);
    return isValidRate(number) ? number : null;
  }

  function getRecord(date) {
    if (!state.records[date]) {
      state.records[date] = emptyRecord();
    }
    return state.records[date];
  }

  function getMonthForPeriod(period) {
    const currentMonth = elements.analyticsMonth.value;
    return period === "previous" ? previousMonthValue(currentMonth) : currentMonth;
  }

  function getMonthlyTariff(month) {
    if (!isMonthString(month)) {
      return emptyMonthlyTariff();
    }

    if (!state.monthlyTariffs[month]) {
      state.monthlyTariffs[month] = emptyMonthlyTariff();
    }

    return state.monthlyTariffs[month];
  }

  function setDifferenceStyle(element, value) {
    element.classList.toggle("positive-value", typeof value === "number" && value > 0);
    element.classList.toggle("negative-value", typeof value === "number" && value < 0);
  }

  function updateTariffMonthLabels(currentMonth) {
    elements.previousTariffDate.textContent = monthLabel(previousMonthValue(currentMonth));
    elements.currentTariffDate.textContent = monthLabel(currentMonth);
  }

  function loadVisibleData() {
    updateTariffMonthLabels(elements.analyticsMonth.value);
    clearTariffErrors();

    elements.tariffInputs.forEach(function (input) {
      const tariff = getMonthlyTariff(getMonthForPeriod(input.dataset.period));
      input.value = formatRate(tariff[input.dataset.tariff]);
      input.removeAttribute("aria-invalid");
    });
  }

  function handleAnalyticsMonthChange() {
    state.analyticsMonth = isMonthString(elements.analyticsMonth.value)
      ? elements.analyticsMonth.value
      : null;
    elements.mainMonth.value = state.analyticsMonth || "";
    saveState();
    loadVisibleData();
    renderMonthDays();
  }

  function handleMainMonthChange() {
    state.analyticsMonth = isMonthString(elements.mainMonth.value)
      ? elements.mainMonth.value
      : null;
    elements.analyticsMonth.value = state.analyticsMonth || "";
    saveState();
    loadVisibleData();
    renderMonthDays();
  }

  function clearTariffErrors() {
    elements.tariffInputs.forEach(function (input) {
      const error = document.querySelector("#" + input.id + "-error");
      error.textContent = "";
    });
  }

  function handleTariffFocus(event) {
    const input = event.currentTarget;
    const parsed = parseRate(input.value);
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
    const value = parseRate(input.value);
    const error = document.querySelector("#" + input.id + "-error");
    const tariff = getMonthlyTariff(getMonthForPeriod(input.dataset.period));

    if (value === null) {
      input.value = "";
      input.setAttribute("aria-invalid", "true");
      error.textContent = input.dataset.tariff === "vat"
        ? "Введите НДС: 0 или больше"
        : "Введите тариф: 0 или больше";
      return;
    }

    tariff[input.dataset.tariff] = value;
    input.value = formatRate(value);
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    saveState();
    renderMonthSummary(elements.analyticsMonth.value);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function findZipDirectory(view) {
    const minimumOffset = Math.max(0, view.byteLength - 65557);

    for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
      if (readUint32(view, offset) === 0x06054b50) {
        return {
          entryCount: view.getUint16(offset + 10, true),
          directoryOffset: readUint32(view, offset + 16)
        };
      }
    }

    throw new Error("Файл не является корректной книгой Excel");
  }

  function indexZipEntries(buffer) {
    const view = new DataView(buffer);
    const directory = findZipDirectory(view);
    const decoder = new TextDecoder("utf-8");
    const entries = {};
    let offset = directory.directoryOffset;

    for (let index = 0; index < directory.entryCount; index += 1) {
      if (readUint32(view, offset) !== 0x02014b50) {
        throw new Error("Не удалось прочитать содержимое файла Excel");
      }

      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
      const name = decoder.decode(nameBytes).replace(/\\/g, "/");

      entries[name] = {
        method: view.getUint16(offset + 10, true),
        compressedSize: readUint32(view, offset + 20),
        uncompressedSize: readUint32(view, offset + 24),
        localOffset: readUint32(view, offset + 42)
      };

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return { buffer: buffer, view: view, entries: entries };
  }

  async function extractZipEntry(zip, name) {
    const entry = zip.entries[name];
    if (!entry) {
      return null;
    }

    if (readUint32(zip.view, entry.localOffset) !== 0x04034b50) {
      throw new Error("Повреждена структура файла Excel");
    }

    const nameLength = zip.view.getUint16(entry.localOffset + 26, true);
    const extraLength = zip.view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = new Uint8Array(zip.buffer, start, entry.compressedSize);

    if (entry.method === 0) {
      return compressed.slice().buffer;
    }

    if (entry.method !== 8 || typeof DecompressionStream !== "function") {
      throw new Error("Этот браузер не может распаковать выбранный файл .xlsx");
    }

    let stream;
    try {
      stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch (error) {
      throw new Error("Этот браузер не может распаковать выбранный файл .xlsx");
    }

    let output;
    try {
      output = await new Response(stream).arrayBuffer();
    } catch (error) {
      throw new Error("Не удалось распаковать выбранный файл .xlsx");
    }
    if (entry.uncompressedSize && output.byteLength !== entry.uncompressedSize) {
      throw new Error("Не удалось полностью прочитать файл Excel");
    }
    return output;
  }

  async function extractZipText(zip, name) {
    const data = await extractZipEntry(zip, name);
    return data === null ? null : new TextDecoder("utf-8").decode(data);
  }

  function parseXml(text) {
    const documentNode = new DOMParser().parseFromString(text, "application/xml");
    if (documentNode.getElementsByTagName("parsererror").length) {
      throw new Error("Не удалось прочитать таблицу в файле Excel");
    }
    return documentNode;
  }

  function normalizeZipPath(base, target) {
    const source = target.charAt(0) === "/" ? target.slice(1) : base + "/" + target;
    const parts = [];
    source.split("/").forEach(function (part) {
      if (!part || part === ".") {
        return;
      }
      if (part === "..") {
        parts.pop();
      } else {
        parts.push(part);
      }
    });
    return parts.join("/");
  }

  function readSharedStrings(documentNode) {
    return Array.from(documentNode.getElementsByTagName("si")).map(function (item) {
      return Array.from(item.getElementsByTagName("t")).map(function (textNode) {
        return textNode.textContent || "";
      }).join("");
    });
  }

  function columnIndex(reference) {
    const letters = String(reference || "").match(/^[A-Z]+/i);
    if (!letters) {
      return -1;
    }

    return letters[0].toUpperCase().split("").reduce(function (total, letter) {
      return total * 26 + letter.charCodeAt(0) - 64;
    }, 0) - 1;
  }

  function cellText(cell) {
    return Array.from(cell.getElementsByTagName("t")).map(function (node) {
      return node.textContent || "";
    }).join("");
  }

  function readCellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t") || "n";
    if (type === "inlineStr") {
      return cellText(cell);
    }

    const valueNode = cell.getElementsByTagName("v")[0];
    const raw = valueNode ? valueNode.textContent || "" : "";

    if (type === "s") {
      const index = Number(raw);
      return Number.isInteger(index) && sharedStrings[index] !== undefined ? sharedStrings[index] : "";
    }

    if (type === "n" && raw !== "") {
      const number = Number(raw);
      return Number.isFinite(number) ? number : raw;
    }

    return raw;
  }

  function readSheetRows(documentNode, sharedStrings) {
    return Array.from(documentNode.getElementsByTagName("row")).map(function (row, rowIndex) {
      const rowNumber = Number(row.getAttribute("r")) || rowIndex + 1;
      const cells = [];

      Array.from(row.getElementsByTagName("c")).forEach(function (cell) {
        const index = columnIndex(cell.getAttribute("r"));
        if (index >= 0) {
          cells[index] = readCellValue(cell, sharedStrings);
        }
      });

      return { rowNumber: rowNumber, cells: cells };
    });
  }

  async function readFirstXlsxSheet(file) {
    const zip = indexZipEntries(await file.arrayBuffer());
    const workbookText = await extractZipText(zip, "xl/workbook.xml");
    const relationsText = await extractZipText(zip, "xl/_rels/workbook.xml.rels");

    if (!workbookText || !relationsText) {
      throw new Error("В файле не найдена книга Excel");
    }

    const workbook = parseXml(workbookText);
    const firstSheet = workbook.getElementsByTagName("sheet")[0];
    if (!firstSheet) {
      throw new Error("В файле нет листов");
    }

    const relationId = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relations = parseXml(relationsText);
    const relation = Array.from(relations.getElementsByTagName("Relationship")).find(function (item) {
      return item.getAttribute("Id") === relationId;
    });

    if (!relation) {
      throw new Error("Не удалось найти первый лист Excel");
    }

    const sheetPath = normalizeZipPath("xl", relation.getAttribute("Target") || "");
    const sheetText = await extractZipText(zip, sheetPath);
    if (!sheetText) {
      throw new Error("Не удалось прочитать первый лист Excel");
    }

    const sharedText = await extractZipText(zip, "xl/sharedStrings.xml");
    const sharedStrings = sharedText ? readSharedStrings(parseXml(sharedText)) : [];
    const workbookProperties = workbook.getElementsByTagName("workbookPr")[0];
    const uses1904Dates = Boolean(workbookProperties && /^(?:1|true)$/i.test(workbookProperties.getAttribute("date1904") || ""));

    return {
      rows: readSheetRows(parseXml(sheetText), sharedStrings),
      uses1904Dates: uses1904Dates
    };
  }

  function normalizeHeader(value) {
    return String(value === undefined ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]/g, "");
  }

  function findImportColumns(headerCells) {
    const columns = { date: -1, hour: -1, volume: -1 };

    headerCells.forEach(function (value, index) {
      const header = normalizeHeader(value);
      if (header === "дата") {
        columns.date = index;
      } else if (header === "час") {
        columns.hour = index;
      } else if (header === "объемквтч") {
        columns.volume = index;
      }
    });

    return columns;
  }

  function excelSerialToDateString(value, uses1904Dates) {
    if (!Number.isFinite(value) || value < 0 || Math.abs(value - Math.round(value)) > 0.0000001) {
      return null;
    }

    const epoch = uses1904Dates ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(value) * 86400000);
    const year = String(date.getUTCFullYear()).padStart(4, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function parseImportDate(value, uses1904Dates) {
    if (typeof value === "number") {
      return excelSerialToDateString(value, uses1904Dates);
    }

    const text = String(value === undefined ? "" : value).trim();
    const localMatch = text.match(/^(\d{2})[.](\d{2})[.](\d{4})$/);
    if (localMatch) {
      const candidate = localMatch[3] + "-" + localMatch[2] + "-" + localMatch[1];
      return isDateString(candidate) ? candidate : null;
    }

    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
    return isoMatch && isDateString(isoMatch[1]) ? isoMatch[1] : null;
  }

  function parseImportHour(value) {
    if (typeof value === "number") {
      return Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
    }

    const text = String(value === undefined ? "" : value).trim();
    if (/^\d{1,2}$/.test(text)) {
      const hour = Number(text);
      return hour >= 0 && hour <= 23 ? hour : null;
    }

    const interval = text.match(/^(\d{1,2}):00\s*[-–—]\s*(\d{1,2}):00$/);
    if (!interval) {
      return null;
    }

    const start = Number(interval[1]);
    const end = Number(interval[2]);
    return start >= 0 && start <= 23 && end === (start + 1) % 24 ? start : null;
  }

  function parseImportVolume(value) {
    if (typeof value === "number") {
      return isValidVolume(value) ? value : null;
    }

    const text = String(value === undefined ? "" : value).trim().replace(",", ".");
    if (!/^(?:\d+(?:[.]\d*)?|[.]\d+)$/.test(text)) {
      return null;
    }

    const number = Number(text);
    return isValidVolume(number) ? number : null;
  }

  function isBlankCell(value) {
    return value === undefined || value === null || String(value).trim() === "";
  }

  function monthLabel(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(monthKey || "")) {
      return "—";
    }
    const parts = monthKey.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
      .format(new Date(parts[0], parts[1] - 1, 1));
  }

  function validateImportSheet(sheet) {
    const errors = [];
    const records = [];
    const dates = new Set();
    const months = new Set();
    const pairs = new Set();
    const headerRow = sheet.rows.find(function (row) { return row.rowNumber === 1; });

    if (!headerRow) {
      errors.push("Строка 1: добавьте заголовки Дата, Час, Объём (кВт*ч)");
      return { errors: errors, records: records, dates: dates, months: [], total: 0, replacementCount: 0 };
    }

    const columns = findImportColumns(headerRow.cells);
    if (columns.date < 0) {
      errors.push("Строка 1: не найден столбец Дата");
    }
    if (columns.hour < 0) {
      errors.push("Строка 1: не найден столбец Час");
    }
    if (columns.volume < 0) {
      errors.push("Строка 1: не найден столбец Объём (кВт*ч)");
    }
    if (errors.length) {
      return { errors: errors, records: records, dates: dates, months: [], total: 0, replacementCount: 0 };
    }

    const dataRows = sheet.rows.filter(function (row) {
      return row.rowNumber > 1 && [columns.date, columns.hour, columns.volume].some(function (index) {
        return !isBlankCell(row.cells[index]);
      });
    });

    if (!dataRows.length) {
      errors.push("Файл: на первом листе нет строк с данными");
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
      errors.push("Файл: строк больше " + MAX_IMPORT_ROWS);
    }

    dataRows.slice(0, MAX_IMPORT_ROWS).forEach(function (row) {
      const dateValue = row.cells[columns.date];
      const hourValue = row.cells[columns.hour];
      const volumeValue = row.cells[columns.volume];
      const date = parseImportDate(dateValue, sheet.uses1904Dates);
      const hour = parseImportHour(hourValue);
      const volume = parseImportVolume(volumeValue);
      let rowIsValid = true;

      if (!date) {
        errors.push("Строка " + row.rowNumber + ": " + (isBlankCell(dateValue) ? "дата не указана" : "неверная дата"));
        rowIsValid = false;
      }
      if (hour === null) {
        errors.push("Строка " + row.rowNumber + ": " + (isBlankCell(hourValue) ? "час не указан" : "час должен быть от 0 до 23"));
        rowIsValid = false;
      }
      if (volume === null) {
        const numeric = Number(String(volumeValue).trim().replace(",", "."));
        const message = Number.isFinite(numeric) && numeric < 0
          ? "объём не может быть отрицательным"
          : (isBlankCell(volumeValue) ? "объём не указан" : "неверный объём");
        errors.push("Строка " + row.rowNumber + ": " + message);
        rowIsValid = false;
      }

      if (!rowIsValid) {
        return;
      }

      const pair = date + "|" + hour;
      if (pairs.has(pair)) {
        errors.push("Строка " + row.rowNumber + ": дата и час повторяются");
        return;
      }

      pairs.add(pair);
      dates.add(date);
      months.add(date.slice(0, 7));
      records.push({ date: date, hour: hour, volume: volume, rowNumber: row.rowNumber });
    });

    const monthList = Array.from(months).sort();
    const replacementCount = records.filter(function (record) {
      return getStoredVolume(record.date, record.hour) !== null;
    }).length;

    return {
      errors: errors,
      records: records,
      dates: dates,
      months: monthList,
      total: records.reduce(function (sum, record) { return sum + record.volume; }, 0),
      replacementCount: replacementCount
    };
  }

  function renderImportResult(fileName, result) {
    const hasErrors = result.errors.length > 0;
    pendingImport = hasErrors ? null : result;
    elements.importResult.hidden = false;
    elements.importStatus.textContent = hasErrors
      ? "Файл не прошёл проверку"
      : "Файл проверен, данные не загружены";
    elements.importStatus.classList.toggle("has-errors", hasErrors);
    elements.importFileName.textContent = fileName || "—";
    elements.importMonth.textContent = result.months.length
      ? result.months.map(monthLabel).join(", ")
      : "—";
    elements.importRowCount.textContent = String(result.records.length);
    elements.importDateCount.textContent = String(result.dates.size);
    elements.importTotal.textContent = formatNumber(result.total, DISPLAY_VOLUME_DECIMALS);
    elements.importReplacementCount.textContent = String(result.replacementCount);
    elements.importErrors.hidden = !hasErrors;
    elements.importErrorList.replaceChildren();

    result.errors.forEach(function (message) {
      const item = document.createElement("li");
      item.textContent = message;
      elements.importErrorList.appendChild(item);
    });

    elements.loadXlsx.disabled = hasErrors;
    elements.importActionHelp.textContent = hasErrors
      ? "Исправьте ошибки и проверьте файл снова."
      : "Проверьте итог и загрузите объёмы.";
  }

  function resetImportCheck() {
    pendingImport = null;
    elements.loadXlsx.disabled = true;
    elements.importResult.hidden = true;
  }

  function emptyImportResult(message) {
    return {
      errors: [message],
      records: [],
      dates: new Set(),
      months: [],
      total: 0,
      replacementCount: 0
    };
  }

  async function handleXlsxCheck() {
    const file = elements.xlsxFile.files[0];
    if (!file) {
      renderImportResult("—", emptyImportResult("Файл: выберите файл .xlsx"));
      return;
    }

    if (!/[.]xlsx$/i.test(file.name)) {
      renderImportResult(file.name, emptyImportResult("Файл: сохраните файл в формате .xlsx"));
      return;
    }

    if (file.size > MAX_XLSX_SIZE) {
      renderImportResult(file.name, emptyImportResult("Файл больше 5 МБ"));
      return;
    }

    elements.checkXlsx.disabled = true;
    elements.checkXlsx.textContent = "Проверяем…";

    try {
      const sheet = await readFirstXlsxSheet(file);
      renderImportResult(file.name, validateImportSheet(sheet));
    } catch (error) {
      const message = error && error.message ? error.message : "Не удалось прочитать файл Excel";
      renderImportResult(file.name, emptyImportResult("Файл: " + message));
    } finally {
      elements.checkXlsx.disabled = false;
      elements.checkXlsx.textContent = "Проверить файл";
    }
  }

  function handleXlsxLoad() {
    if (!pendingImport || pendingImport.errors.length || !pendingImport.records.length) {
      return;
    }

    const result = pendingImport;
    const nextState = JSON.parse(JSON.stringify(state));
    const latestMonth = result.months[result.months.length - 1];

    result.records.forEach(function (record) {
      if (!nextState.records[record.date]) {
        nextState.records[record.date] = emptyRecord();
      } else {
        nextState.records[record.date] = cleanRecord(nextState.records[record.date]);
      }
      nextState.records[record.date].volumes[record.hour] = record.volume;
    });
    nextState.analyticsMonth = latestMonth;

    if (!saveState(nextState)) {
      elements.importStatus.textContent = "Не удалось сохранить объёмы";
      elements.importStatus.classList.add("has-errors");
      elements.importActionHelp.textContent = "Проверьте доступ к хранилищу браузера и повторите загрузку.";
      return;
    }

    state = nextState;
    pendingImport = null;
    elements.loadXlsx.disabled = true;
    elements.importStatus.textContent = "Загружено: " + result.records.length + " строк за "
      + result.months.map(monthLabel).join(", ");
    elements.importStatus.classList.remove("has-errors");
    elements.importActionHelp.textContent = "Объёмы сохранены в браузере.";

    elements.analyticsMonth.value = latestMonth;
    elements.mainMonth.value = latestMonth;
    loadVisibleData();
    renderMonthDays();
  }

  function initialize() {
    elements.viewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        showView(button.dataset.viewTarget);
      });
    });
    const currentMonth = toDateInputValue(new Date()).slice(0, 7);
    const legacySelectedMonth = state.selected && isDateString(state.selected.current)
      ? state.selected.current.slice(0, 7)
      : null;
    elements.analyticsMonth.value = state.analyticsMonth || legacySelectedMonth || currentMonth;
    elements.mainMonth.value = elements.analyticsMonth.value;

    elements.mainMonth.addEventListener("change", handleMainMonthChange);
    elements.analyticsMonth.addEventListener("change", handleAnalyticsMonthChange);
    elements.xlsxFile.addEventListener("change", function () {
      resetImportCheck();
    });
    elements.checkXlsx.addEventListener("click", handleXlsxCheck);
    elements.loadXlsx.addEventListener("click", handleXlsxLoad);
    elements.tariffInputs.forEach(function (input) {
      input.addEventListener("focus", handleTariffFocus);
      input.addEventListener("input", handleTariffInput);
      input.addEventListener("blur", handleTariffBlur);
    });

    state.analyticsMonth = elements.analyticsMonth.value;
    saveState();
    loadVisibleData();
    renderMonthDays();
    showView(state.view);
  }

  initialize();
})();
