import { valueA, funcA, type InterfaceA } from "./moduleA";
import { utilFunc1, internalUtil } from "@/utils"; // Use path alias

export const valueB = `Value from Module B using ${valueA}`;

function privateHelperB() {
	return `${internalUtil()} from B`;
}

export function funcB(): InterfaceA {
	console.log("Function B executed");
	utilFunc1();
	const resultA = funcA();
	console.log("Result from funcA:", resultA);
	console.log(privateHelperB());
	return { id: 1, name: valueB };
}

console.log(valueB);
