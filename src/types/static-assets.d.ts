// Tell TS that importing these returns a string URL
declare module "*.svg" {
	const src: string;
	export default src;
}
declare module "*.svg?url" {
	const src: string;
	export default src;
}
declare module "*.png?url" {
	const src: string;
	export default src;
}
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.webp";