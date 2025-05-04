export class TimeoutError extends Error {
	constructor(
		message: string,
		public readonly durationSeconds: number,
	) {
		super(message);
		this.name = "TimeoutError";
		// Set the prototype explicitly.
		Object.setPrototypeOf(this, TimeoutError.prototype);
	}
}
