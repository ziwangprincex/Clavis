// Tests assert English strings; a Chinese system locale must not switch them.
Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
