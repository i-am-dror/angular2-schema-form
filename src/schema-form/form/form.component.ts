import {
	Component,
	ComponentResolver,
	ElementRef,
	EventEmitter,
	Input,
	Inject,
	Output,
	provide
} from "@angular/core";
import {
	FormControl,
	FormArray,
	Validators
} from "@angular/forms";

import { SchemaValidatorFactory, ZSchemaValidatorFactory } from "../schemavalidatorfactory";
import { Validator } from "../validator";
import { FieldComponent } from "../field.component";
import { WidgetChooserComponent } from "../widgetchooser/widgetchooser.component";
import { WidgetFactory } from "../widgetfactory";
import { WidgetRegistry } from "../widgetregistry";
import { FORM_DIRECTIVES, REACTIVE_FORM_DIRECTIVES } from "@angular/forms";

export interface FormValueChangeEvent {
	source : Form,
	value : string
}

/**
 * The main component
 */
@Component({
	selector: "schema-form",
	directives: [FieldComponent, WidgetChooserComponent, FORM_DIRECTIVES, REACTIVE_FORM_DIRECTIVES],
	providers: [WidgetFactory, provide(SchemaValidatorFactory, {useClass: ZSchemaValidatorFactory}) ],
	template: require("./form.component.html")
})
export class Form {

	private fields = {};
	private fieldsets: { fields: { field: any, type: string, id: string, settings: any }[], id: string, title: string }[] = [];

	private controls: {[name:string]: FormControl} = {};
	private widgets = [];
	private controlArray = new FormArray([]);
	private updatingValidity: boolean = false;

	private buttons = [];

	/**
	 * Schema the form is generated from
	 */
	@Input("schema") jsonSchema: any;

	/**
	 * Input values initially provided to the form
	 */
	@Input("model") initialValue: any = null;

	/**
	 * Custom validators called whenever their corresponding field's value is changed.
	 */
	@Input() fieldValidators: {[fieldId: string]: Validator} = {};

	/**
	 * Actions to perform when a form's button is clicked.
	 */
	@Input() actions: {[actionId: string]: Function} = {};

	/**
	 * EventEmitter triggered when one of the field value is changed
	 */
	@Output() changeEmitter: EventEmitter<FormValueChangeEvent> = new EventEmitter();

	constructor(private elementRef : ElementRef, private schemaValidatorFactory : SchemaValidatorFactory) { }

	/**:
	 * @deprecated
	 * Send the current form's values somewhere to the same location
	 */
	submit() {
		this.elementRef.nativeElement.querySelector("form").submit();
	}

	/**
	 * Erase all fields.
	 */
	reset() {
		this.resetAllFields();
	}

	ngOnChanges(changes) {

		let needRebuild = changes.jsonSchema || (this.jsonSchema && changes.fieldValidators);
		if (needRebuild) {
			this.parseSchema(this.jsonSchema);
		}
		if (needRebuild || changes.initialValue) {

			if (changes.initialValue && changes.initialValue.previousValue) {
				this.resetAllFields();
			}

			if (this.initialValue !== null) {
				this.applyModel();
			}
			this.controlArray.valueChanges.subscribe(() => { this.onFieldValueChange(); });
			this.updateFieldsVisibility();
		}
	}

	private parseSchema(schema: any) {
		this.controlArray = new FormArray([]);
		this.buttons = [];
		this.fieldsets = [];
		this.fields = {};
		this.widgets = [];

		if (schema.hasOwnProperty("fieldsets")) {
			this.parseFieldsets(schema);
		} else if (schema.hasOwnProperty("order")) {
			this.parseOrder(schema);
		}

		this.parseButtons(schema);
		this.resetAllFields();
	}

	private parseFieldsets(schema: any) {
		for (let fieldsetId in schema.fieldsets) {
			let fieldsetSchema = schema.fieldsets[fieldsetId];
			let fieldset = { fields: [], id: fieldsetSchema.id, title: fieldsetSchema.title };

			for (let fieldId of fieldsetSchema.fields) {
				this.parseField(schema, fieldId);
				fieldset.fields.push(fieldId);
			}
			this.fieldsets.push(fieldset);
		}
	}

	private parseField(schema, fieldId) {
		let field = {id: fieldId};

		let fieldSchema = schema.properties[fieldId];

		let validators = this.schemaValidatorFactory.createValidatorFn(fieldSchema);
		let customValidator = this.createCustomValidatorFn(fieldId);
		validators = Validators.compose([customValidator, validators]);

		if (schema.required.indexOf(fieldId) > -1) {
			validators = Validators.compose([Validators.required, validators]);
		}
		let control = new FormControl("", [validators]);
		control.valueChanges.subscribe( () => { this.updateFieldsValidity(control) });
		this.controlArray.push(control);
		this.controls[fieldId] = control;

		this.widgets[fieldId] = this.extractWidget(fieldSchema);
		this.fields[fieldId] = { id: fieldId, settings: fieldSchema, control: control, visible: false };

		return fieldSchema;
	}

	private extractWidget(fieldSchema) {
		let widget = fieldSchema.widget;
		if (widget === undefined) {
			widget = {"id": fieldSchema.type};
		} else if (typeof widget === "string") {
			widget = {"id": widget};
		}
		delete fieldSchema.widget;
		return widget;
	}

	private createCustomValidatorFn(fieldId: string) {
		return (control): { [key:string]: boolean } => {
			let model = this.getModel();
			if (model.hasOwnProperty(fieldId)) {
				let validatorFn;
				if (validatorFn = this.fieldValidators[fieldId]) {
					return validatorFn(control.value, model, this.controls);
				}
			}
		};
	}

	private resetAllFields() {
		for (let field in this.fields) {
			this.resetField(field);
		}
	}

	private resetField(fieldId : string) {
		let settings = this.fields[fieldId].settings;
		//TODO RC5 replace by markAs
		if(!(<any>this.controls[fieldId]).markAsUntouched){
			(<any>this.controls[fieldId])._touched=false;
			(<any>this.controls[fieldId])._pristine=true;
		} else {
			(<any>console).warn("upate to RC5");
			(<any>this.controls[fieldId]).markAsPristine();
			(<any>this.controls[fieldId]).markAsUntouched();
		}

		let val: any = "";

		if (settings.hasOwnProperty("default")) {
			val = settings.default;
		} else if (settings.type === "number") {
			if (settings.minimum !== undefined) {
				val = settings.minimum;
			} else {
				val = 0;
			}
		}

		settings.value = val;
	}

	private applyModel() {
		for (let fieldId in this.initialValue) {

			if (this.fields.hasOwnProperty(fieldId)) {
				this.fields[fieldId].settings.value = this.initialValue[fieldId];
			}
		}
	}

	private onFieldValueChange() {
		this.updateFieldsVisibility();
		this.changeEmitter.emit({source: this, value: this.getModel()})
	}

	private updateFieldsVisibility() {
		for (let fieldIdx in this.fields) {
			let field = this.fields[fieldIdx];

			if (field.settings.hasOwnProperty("visibleIf")) {
				this.updateFieldVisibility(field);
			} else {
				field.visible = true;
			}
		}
	}

	private updateFieldVisibility(field) {
		let visibleIf = field.settings.visibleIf;
		for (let conditionField in visibleIf) {

			if (this.fields[conditionField].visible) {
				let values = visibleIf[conditionField];
				let control = this.controls[conditionField];

				if (values.indexOf(control.value) > -1) {
					field.visible = true;
					return;
				}
			}
		}
		field.visible = false;
	}

	private updateFieldsValidity(sourceControl : FormControl) {
		if ( ! this.updatingValidity ) {
			this.updatingValidity = true;
			let validityBefore = this.getValidityArray();
			this.updateFieldsValidityImpl(sourceControl, validityBefore)
			this.updatingValidity = false;
		}
	}

	private updateFieldsValidityImpl(sourceControl : FormControl, validityBefore: string) {
		for (let fieldId in this.controls) {
			let control = this.controls[fieldId];
			if(control !== sourceControl) {
				this.controls[fieldId].updateValueAndValidity();
			}
		}

		let validityAfter = this.getValidityArray();
		if (validityBefore !== validityAfter) {
			this.updateFieldsValidityImpl(sourceControl, validityAfter);
		}
	}

	private getValidityArray() {
		let arr = [];
		for (let fieldId in this.controls) {
			arr.push(this.controls[fieldId].valid);
		}
		return arr.join("");
	}

	private parseOrder(schema: any) {
		schema.fieldsets = [{
			id: "fieldset-default",
			title: "",
			fields: schema.order
		}];
		this.parseFieldsets(schema);
	}

	private parseButtons(schema) {
		if (schema.buttons !== undefined) {
			this.buttons = schema.buttons;

			for (let button of this.buttons) {
				button.action = (event) => {
					if (button.id && this.actions[button.id]) {
						this.actions[button.id](this, button.parameters);
					}
					event.preventDefault();
				};
			}
		}
	}

	getModel(): any {
		let model = {};
		for (let id in this.fields) {
			let field = this.fields[id];
			if (field.visible) {
				model[field.id] = field.settings.value;
			}
		}
		return model;
	}
}
