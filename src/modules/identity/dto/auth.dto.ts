import { createZodDto } from 'nestjs-zod';
import { SignUpBody, SignInBody } from '../../../contract/api/identity';

export class SignUpDto extends createZodDto(SignUpBody) {}
export class SignInDto extends createZodDto(SignInBody) {}
