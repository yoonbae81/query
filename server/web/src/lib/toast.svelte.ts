class ToastState {
  message = $state("");
  isError = $state(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, isError = false): void {
    this.message = message;
    this.isError = isError;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.message = ""), 3500);
  }
}

export const toast = new ToastState();
