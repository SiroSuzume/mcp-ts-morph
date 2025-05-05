import { valueA } from "./moduleA"; // moduleA への依存

// エクスポートされる関数
export function utilFunc1(): void {
	console.log("Util Func 1 executed with value:", valueA);
}

// エクスポートされない内部ヘルパー関数
function internalUtil(): string {
	return "Internal Util Result";
}

// 内部ヘルパー関数を利用する別のエクスポート関数
export function utilFunc2(): string {
	const internalResult = internalUtil();
	return `Util Func 2 using ${internalResult}`;
}

function anotherInternalConsumer(): string {
	return `Another consumer: ${internalUtil()}`;
}

export function publicConsumer(): string {
	return anotherInternalConsumer();
}

export const utilValue = 123;

export type UtilType = {
	key: string;
	value: number;
};
