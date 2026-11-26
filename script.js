(function () {
  "use strict";

  const STORAGE_KEY = "energyPlannerComparisonV1";
  const HOUR_COUNT = 24;
  const DISPLAY_VOLUME_DECIMALS = 6;
  const MAX_XLSX_SIZE = 5 * 1024 * 1024;
  const MAX_IMPORT_ROWS = 31 * HOUR_COUNT;

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
    importErrors: document.querySelector("#import-errors"),
    importErrorList: document.querySelector("#import-error-list"),
    importActionHelp: document.querySelector("#import-action-help"),
    tariffInputs: Array.from(document.querySelectorAll(".tariff-input"))
  };

  let state = readState();
  let pairIsValid = false;
  let pendingImport = null;
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
    resetImportCheck();

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
      return Number.isFinite(value) && value >= 0 ? value : null;
    }

    const text = String(value === undefined ? "" : value).trim().replace(",", ".");
    if (!/^(?:\d+(?:[.]\d*)?|[.]\d+)$/.test(text)) {
      return null;
    }

    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : null;
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

  function shortMonthLabel(monthKey) {
    const parts = String(monthKey || "").split("-");
    return parts.length === 2 ? parts[1] + "." + parts[0] : "—";
  }

  function expectedImportMonth() {
    const current = parseLocalDate(elements.currentDate.value);
    if (!current) {
      return null;
    }
    const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    return String(previous.getFullYear()).padStart(4, "0") + "-" + String(previous.getMonth() + 1).padStart(2, "0");
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
      return { errors: errors, records: records, dates: dates, month: null, total: 0 };
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
      return { errors: errors, records: records, dates: dates, month: null, total: 0 };
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

    let month = months.size === 1 ? Array.from(months)[0] : null;
    if (months.size > 1) {
      errors.push("Файл: должны быть данные одного месяца");
    }

    const expectedMonth = expectedImportMonth();
    if (month && expectedMonth && month !== expectedMonth) {
      errors.push("Файл: загрузите данные за " + monthLabel(expectedMonth));
    }

    return {
      errors: errors,
      records: records,
      dates: dates,
      month: month,
      total: records.reduce(function (sum, record) { return sum + record.volume; }, 0)
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
    elements.importMonth.textContent = result.month ? monthLabel(result.month) : "—";
    elements.importRowCount.textContent = String(result.records.length);
    elements.importDateCount.textContent = String(result.dates.size);
    elements.importTotal.textContent = formatNumber(result.total, DISPLAY_VOLUME_DECIMALS);
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
      month: null,
      total: 0
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

    const expectedMonth = expectedImportMonth();
    if (!expectedMonth || pendingImport.month !== expectedMonth) {
      pendingImport = null;
      elements.loadXlsx.disabled = true;
      elements.importStatus.textContent = "Дата текущего месяца изменилась";
      elements.importStatus.classList.add("has-errors");
      elements.importActionHelp.textContent = "Проверьте файл снова для выбранных дат.";
      return;
    }

    const result = pendingImport;
    const nextState = JSON.parse(JSON.stringify(state));

    result.records.forEach(function (record) {
      if (!nextState.records[record.date]) {
        nextState.records[record.date] = emptyRecord();
      } else {
        nextState.records[record.date] = cleanRecord(nextState.records[record.date]);
      }
      nextState.records[record.date].volumes[record.hour] = record.volume;
    });

    if (!saveState(nextState)) {
      elements.importStatus.textContent = "Не удалось сохранить объёмы";
      elements.importStatus.classList.add("has-errors");
      elements.importActionHelp.textContent = "Проверьте доступ к хранилищу браузера и повторите загрузку.";
      return;
    }

    state = nextState;
    pendingImport = null;
    elements.loadXlsx.disabled = true;
    elements.importStatus.textContent = "Загружено: " + result.records.length + " строк за " + shortMonthLabel(result.month);
    elements.importStatus.classList.remove("has-errors");
    elements.importActionHelp.textContent = "Объёмы сохранены в браузере.";

    if (result.dates.has(elements.previousDate.value)) {
      loadVisibleData();
    }
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
