import { Redirect } from 'expo-router';
import { MANAGEMENT_HOME } from '../../lib/managementNavigation';
export default function ManagementDirectoryRedirect() { return <Redirect href={MANAGEMENT_HOME} />; }
