/* The example note on coder.kahflabs.com: "Run" reveals the output that was worked out in advance.
   Nothing is executed in the browser. */
const announcer = document.querySelector<HTMLElement>('[data-announce]');

document.querySelectorAll<HTMLElement>('[data-run-block]').forEach((block) => {
  const button = block.querySelector<HTMLButtonElement>('[data-run]');
  const label = block.querySelector<HTMLElement>('[data-run-label]');
  const output = block.querySelector<HTMLElement>('[data-run-output]');
  if (!button || !label || !output) return;
  const idle = label.textContent ?? '';
  button.addEventListener('click', () => {
    output.hidden = true;
    button.disabled = true;
    label.textContent = button.dataset.running ?? idle;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      output.hidden = false;
      button.disabled = false;
      label.textContent = idle;
      if (announcer) announcer.textContent = `${button.dataset.ran ?? ''}: ${output.querySelector('samp')?.textContent ?? ''}`;
    }, reduce ? 0 : 420);
  });
});
